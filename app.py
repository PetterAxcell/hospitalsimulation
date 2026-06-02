from __future__ import annotations

from dataclasses import replace
from textwrap import wrap

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
import streamlit.components.v1 as components

from hospital_sim.architecture import (
    architecture_metrics,
    block_floors,
    prepare_architecture_blocks,
    resource_locations_from_blocks,
)
from hospital_sim.config import CapacityConfig, HospitalConfig
from hospital_sim.engine import patient_records, run_simulation
from hospital_sim.game_view import build_game_payload, render_game_view
from hospital_sim.master_plan import build_master_plan
from hospital_sim.scenarios import compare_scenarios, optimize_capacity, scenario_library


st.set_page_config(page_title="Simulador hospitalario", layout="wide")


@st.cache_data(show_spinner=False)
def cached_run(config: HospitalConfig):
    return run_simulation(config)


@st.cache_data(show_spinner=False)
def cached_compare(config: HospitalConfig):
    return compare_scenarios(scenario_library(config))


@st.cache_data(show_spinner=False)
def cached_optimize(config: HospitalConfig, budget: float):
    return optimize_capacity(config, budget=budget)


def build_config(architecture_name: str, resource_locations: tuple, layout_metrics: dict) -> HospitalConfig:
    with st.sidebar:
        st.header("Modelo")
        days = st.slider("Dias simulados", 3, 45, 14)
        warmup = st.slider("Dias de calentamiento", 0, min(7, days - 1), min(2, days - 1))
        seed = st.number_input("Semilla", min_value=1, value=42, step=1)
        arrival_scale = st.slider("Demanda global", 0.5, 1.8, 1.0, 0.05)
        ed_scale = st.slider("Demanda urgencias", 0.5, 2.0, 1.0, 0.05)
        outpatient_scale = st.slider("Demanda consultas", 0.4, 1.8, 1.0, 0.05)
        elective_scale = st.slider("Cirugia electiva", 0.4, 1.5, 1.0, 0.05)

        st.header("Politicas")
        early_discharge = st.toggle("Alta temprana", value=False)
        surge_protocol = st.toggle("Surge protocol", value=False)
        dynamic_beds = st.toggle("Camas dinamicas ward/UCI", value=False)

        st.header("Capacidad")
        capacities = CapacityConfig(
            triage_nurses=st.number_input("Enfermeria triaje", 1, 20, 3),
            registration_clerks=st.number_input("Admision", 1, 20, 4),
            ed_bays=st.number_input("Boxes urgencias", 4, 120, 28),
            ed_physicians=st.number_input("Medicos urgencias", 1, 40, 7),
            outpatient_clinicians=st.number_input("Clinicos consultas", 1, 80, 10),
            lab_slots=st.number_input("Slots laboratorio", 1, 50, 6),
            imaging_rooms=st.number_input("Salas imagen", 1, 30, 3),
            pharmacy_windows=st.number_input("Ventanillas farmacia", 1, 30, 3),
            operating_rooms=st.number_input("Quirofanos", 1, 30, 5),
            pacu_beds=st.number_input("Camas PACU", 1, 80, 10),
            ward_beds=st.number_input("Camas hospitalizacion", 20, 800, 150),
            icu_beds=st.number_input("Camas UCI", 2, 200, 18),
            discharge_coordinators=st.number_input("Coordinadores alta", 1, 30, 4),
            transporters=st.number_input("Celadores/transporte", 1, 40, 4),
            elevators=st.number_input("Ascensores clinicos", 1, 20, 3),
        )
    return HospitalConfig(
        days=days,
        warmup_days=warmup,
        seed=int(seed),
        arrival_scale=arrival_scale,
        ed_scale=ed_scale,
        outpatient_scale=outpatient_scale,
        elective_surgery_scale=elective_scale,
        early_discharge=early_discharge,
        surge_protocol=surge_protocol,
        dynamic_bed_pool=dynamic_beds,
        capacities=capacities,
        architecture_name=architecture_name,
        resource_locations=resource_locations,
        horizontal_travel_factor=float(layout_metrics.get("horizontal_factor", 1.0)),
        vertical_travel_factor=float(layout_metrics.get("vertical_factor", 1.0)),
    )


def kpi_row(kpis: dict[str, float]) -> None:
    cols = st.columns(6)
    cols[0].metric("Pacientes", f"{int(kpis['patients_completed']):,}".replace(",", "."))
    cols[1].metric("P90 LOS ED", f"{kpis['ed_los_p90_min'] / 60:.1f} h")
    cols[2].metric("P90 boarding ED", f"{kpis['boarding_p90_min'] / 60:.1f} h")
    cols[3].metric("P90 bloqueo PACU", f"{kpis['pacu_boarding_p90_min'] / 60:.1f} h")
    cols[4].metric("P90 traslado", f"{kpis.get('architecture_travel_p90_min', 0):.1f} min")
    cols[5].metric("Recursos >85%", f"{int(kpis['resources_over_85pct'])}")


def resource_dataframe(result) -> pd.DataFrame:
    rows = [
        {
            "recurso": stat.resource,
            "capacidad": stat.capacity,
            "ocupacion": stat.utilization,
            "espera_media_min": stat.wait_mean,
            "espera_p90_min": stat.wait_p90,
            "cola_max": stat.max_queue,
            "horas_ocupadas": stat.busy_hours,
        }
        for stat in result.resource_stats
    ]
    return pd.DataFrame(rows).sort_values("ocupacion", ascending=False)


ARCHITECTURE_COLORS = {
    "public": "#8ecae6",
    "waiting": "#bde0fe",
    "ambulatory": "#95d5b2",
    "emergency": "#f4a261",
    "ambulance": "#e76f51",
    "diagnostic": "#90be6d",
    "surgery": "#e9c46a",
    "critical": "#d62828",
    "inpatient": "#2a9d8f",
    "logistics": "#6c757d",
    "research": "#7c6bb0",
    "maternal_child": "#ffafcc",
    "oncology": "#b5179e",
    "garden": "#74c69d",
    "future": "#ced4da",
}

FLOW_COLORS = {
    "public": "#1d4ed8",
    "ambulance": "#d62828",
    "logistics": "#343a40",
    "clinical": "#2a9d8f",
}


def architecture_label(name: str, width: float) -> str:
    chars = max(7, min(16, int(width * 0.85)))
    parts = wrap(name, width=chars, break_long_words=False)
    if len(parts) > 3:
        parts = parts[:3]
        parts[-1] = f"{parts[-1]}..."
    return "<br>".join(parts)


def architecture_state_key(option_name: str) -> str:
    return f"architecture_blocks::{option_name}"


def current_architecture_blocks(option: dict) -> list[dict]:
    key = architecture_state_key(option["option"])
    if key not in st.session_state:
        st.session_state[key] = prepare_architecture_blocks(option)
    return list(st.session_state[key])


def architecture_figure(option: dict, blocks: list[dict], floor_filter: int | None) -> go.Figure:
    fig = go.Figure()
    fig.add_shape(type="rect", x0=0, y0=0, x1=100, y1=70, line={"color": "#94a3b8", "width": 2}, fillcolor="#eef6e9")
    fig.add_shape(type="rect", x0=0, y0=64, x1=100, y1=70, line={"width": 0}, fillcolor="#d7e3ce")
    fig.add_shape(type="rect", x0=0, y0=0, x1=100, y1=5, line={"width": 0}, fillcolor="#d7e3ce")
    fig.add_annotation(
        x=50,
        y=67,
        text="Azul: publico · Rojo: ambulancias · Gris: logistica · Verde: clinico",
        showarrow=False,
        font={"size": 11, "color": "#334155"},
    )
    visible_blocks = [
        block
        for block in blocks
        if floor_filter is None or floor_filter in block_floors(block)
    ]
    for block in visible_blocks:
        color = ARCHITECTURE_COLORS.get(block["kind"], "#adb5bd")
        fig.add_shape(
            type="rect",
            x0=block["x"],
            y0=block["y"],
            x1=block["x"] + block["w"],
            y1=block["y"] + block["h"],
            line={"color": "#23312b", "width": 1.4},
            fillcolor=color,
            opacity=0.86,
        )
    if floor_filter in (None, 0):
        for flow in option["flows"]:
            fig.add_shape(
                type="line",
                x0=flow["from"][0],
                y0=flow["from"][1],
                x1=flow["to"][0],
                y1=flow["to"][1],
                line={"color": FLOW_COLORS.get(flow["kind"], "#111827"), "width": 4},
            )
    for block in visible_blocks:
        label = architecture_label(block["name"], block["w"])
        font_size = 8 if block["w"] < 12 or block["h"] < 10 else 9
        fig.add_annotation(
            x=block["x"] + block["w"] / 2,
            y=block["y"] + block["h"] / 2,
            text=f"<b>{label}</b><br>{block['floor']}",
            showarrow=False,
            font={"size": font_size, "color": "#17201c"},
            align="center",
        )
    fig.update_xaxes(visible=False, range=[0, 100], fixedrange=True)
    fig.update_yaxes(visible=False, range=[0, 70], fixedrange=True, scaleanchor="x", scaleratio=1)
    fig.update_layout(
        height=620,
        margin={"l": 10, "r": 10, "t": 45, "b": 10},
        title=f"{option['option']} · {option['archetype']} · {'Todas las plantas' if floor_filter is None else f'Planta {floor_filter}'}",
        paper_bgcolor="#ffffff",
        plot_bgcolor="#eef6e9",
    )
    return fig


def render_vision_tab(master_plan: dict) -> None:
    options = master_plan["architecture_options"]
    selected_name = st.session_state.get("architecture_option", options[0]["option"])
    option = next(item for item in options if item["option"] == selected_name)
    blocks = current_architecture_blocks(option)
    metrics = architecture_metrics(blocks)
    locations = resource_locations_from_blocks(blocks)

    toolbar = st.columns([0.28, 0.22, 0.16, 0.16, 0.18])
    floor_options = ["Todas", -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    floor_value = toolbar[0].selectbox("Planta a visualizar", floor_options, index=2, key="architecture_floor_view")
    floor_filter = None if floor_value == "Todas" else int(floor_value)
    toolbar[1].metric("Recorrido critico", f"{metrics['hot_path_distance']}")
    toolbar[2].metric("Saltos verticales", f"{int(metrics['vertical_steps'])}")
    toolbar[3].metric("Factor traslado", f"{metrics['horizontal_factor']}x")
    toolbar[4].metric("Factor ascensor", f"{metrics['vertical_factor']}x")

    cols = st.columns([0.64, 0.36])
    with cols[0]:
        st.plotly_chart(architecture_figure(option, blocks, floor_filter), width="stretch")
    with cols[1]:
        st.markdown(f"**Tesis**  \n{option['thesis']}")
        st.markdown(f"**Trade-offs**  \n{option['tradeoffs']}")
        st.markdown(f"**Lectura simulable**  \n{metrics['interpretation']}")
        st.caption(f"Recursos ubicados para simulacion: {len(locations)}")
        block_summary = pd.DataFrame(blocks).groupby("kind").size().reset_index(name="bloques").sort_values("bloques", ascending=False)
        st.dataframe(block_summary, width="stretch", hide_index=True)

    edit_cols = st.columns([0.78, 0.22])
    edit_cols[0].subheader("Construccion editable")
    if edit_cols[1].button("Restaurar base", use_container_width=True):
        st.session_state[architecture_state_key(option["option"])] = prepare_architecture_blocks(option)
        st.rerun()
    edited = st.data_editor(
        pd.DataFrame(blocks),
        width="stretch",
        hide_index=True,
        num_rows="dynamic",
        column_config={
            "kind": st.column_config.SelectboxColumn("kind", options=list(ARCHITECTURE_COLORS)),
            "node": st.column_config.TextColumn("node simulacion"),
            "x": st.column_config.NumberColumn("x", min_value=0.0, max_value=100.0, step=1.0),
            "y": st.column_config.NumberColumn("y", min_value=0.0, max_value=70.0, step=1.0),
            "w": st.column_config.NumberColumn("w", min_value=3.0, max_value=100.0, step=1.0),
            "h": st.column_config.NumberColumn("h", min_value=3.0, max_value=70.0, step=1.0),
        },
        key=f"architecture_editor::{option['option']}",
    )
    st.session_state[architecture_state_key(option["option"])] = edited.to_dict("records")


def render_architecture_tab(master_plan: dict) -> None:
    total = master_plan["total_gfa_sqm"]
    program_df = pd.DataFrame(master_plan["program"])
    category_df = pd.DataFrame(master_plan["category_summary"])
    core_df = pd.DataFrame(master_plan["vertical_cores"])
    req_df = pd.DataFrame(master_plan["requirements"])
    adjacency_df = pd.DataFrame(master_plan["adjacencies"])
    benchmark_df = pd.DataFrame(master_plan["benchmark_capabilities"])

    st.caption(
        "Base conceptual para planificar desde cero. No sustituye el proyecto normativo; convierte requisitos arquitectonicos en restricciones simulables."
    )
    cols = st.columns(4)
    cols[0].metric("Superficie objetivo", f"{total:,.0f} m2".replace(",", "."))
    cols[1].metric("Programa clinico", f"{int(category_df.loc[category_df['categoria'] == 'Clinico', 'm2'].sum()):,} m2".replace(",", "."))
    cols[2].metric("Nucleos verticales", f"{int(core_df['count'].sum())}")
    cols[3].metric("Huecos benchmark", f"{len(benchmark_df)}")

    left, right = st.columns([1.1, 0.9])
    with left:
        fig = px.treemap(
            program_df,
            path=["categoria", "modulo"],
            values="m2",
            color="categoria",
            title="Programa funcional de 290.000 m2",
        )
        fig.update_layout(height=520)
        st.plotly_chart(fig, width="stretch")
    with right:
        fig = px.bar(
            category_df.sort_values("m2", ascending=True),
            x="m2",
            y="categoria",
            orientation="h",
            title="Distribucion por macro-area",
        )
        fig.update_layout(height=520)
        st.plotly_chart(fig, width="stretch")

    sub_tabs = st.tabs(["Vision", "Programa", "Benchmark", "Nucleos", "Seguridad y flujos", "Adyacencias"])
    with sub_tabs[0]:
        render_vision_tab(master_plan)
    with sub_tabs[1]:
        st.dataframe(program_df, width="stretch", hide_index=True)
    with sub_tabs[2]:
        st.dataframe(benchmark_df, width="stretch", hide_index=True)
    with sub_tabs[3]:
        st.dataframe(core_df, width="stretch", hide_index=True)
    with sub_tabs[4]:
        st.dataframe(req_df, width="stretch", hide_index=True)
    with sub_tabs[5]:
        st.dataframe(adjacency_df, width="stretch", hide_index=True)


with st.sidebar:
    st.header("Arquitectura")
    total_gfa = st.number_input("m2 construidos objetivo", 50_000, 600_000, 290_000, 5_000)

master_plan = build_master_plan(int(total_gfa))
architecture_options = master_plan["architecture_options"]
with st.sidebar:
    selected_architecture = st.selectbox(
        "Arquitectura activa",
        [option["option"] for option in architecture_options],
        key="architecture_option",
    )
active_architecture = next(option for option in architecture_options if option["option"] == selected_architecture)
layout_blocks = current_architecture_blocks(active_architecture)
layout_metrics = architecture_metrics(layout_blocks)
resource_locations = resource_locations_from_blocks(layout_blocks)
config = build_config(selected_architecture, resource_locations, layout_metrics)
st.markdown("### Simulador hospitalario integral")

with st.spinner("Ejecutando simulacion de eventos discretos..."):
    result = cached_run(config)

tabs = st.tabs(["Arquitectura", "Simulacion", "Operacion", "Cuellos", "Escenarios", "Optimizacion", "Pacientes", "Modelo"])

with tabs[0]:
    render_architecture_tab(master_plan)

with tabs[1]:
    components.html(render_game_view(build_game_payload(result, layout_blocks=layout_blocks)), height=820, scrolling=False)

with tabs[2]:
    kpi_row(result.kpis)
    resource_df = resource_dataframe(result)
    left, right = st.columns([1.1, 0.9])
    with left:
        fig = px.bar(
            resource_df,
            x="ocupacion",
            y="recurso",
            orientation="h",
            color="ocupacion",
            color_continuous_scale=["#2A9D8F", "#E9C46A", "#E76F51"],
            range_x=[0, 1],
            title="Ocupacion por recurso",
        )
        fig.add_vline(x=0.85, line_dash="dash", line_color="#D62828")
        fig.update_layout(height=520, yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig, width="stretch")
    with right:
        wait_df = resource_df.sort_values("espera_p90_min", ascending=False).head(10)
        fig = px.bar(
            wait_df,
            x="espera_p90_min",
            y="recurso",
            orientation="h",
            color="espera_p90_min",
            color_continuous_scale=["#457B9D", "#F4A261", "#E76F51"],
            title="Top esperas P90",
        )
        fig.update_layout(height=520, yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig, width="stretch")

    flow = pd.DataFrame(
        [
            {"flujo": "Urgencias", "pacientes": result.kpis["ed_completed"]},
            {"flujo": "Consultas", "pacientes": result.kpis["outpatient_completed"]},
            {"flujo": "Electivo", "pacientes": result.kpis["elective_completed"]},
            {"flujo": "Ingresos", "pacientes": result.kpis["admissions"]},
        ]
    )
    st.plotly_chart(px.bar(flow, x="flujo", y="pacientes", color="flujo", title="Volumen por flujo"), width="stretch")

with tabs[3]:
    bottleneck_df = pd.DataFrame(result.bottlenecks)
    if bottleneck_df.empty:
        st.success("No aparecen cuellos criticos con los umbrales actuales.")
    else:
        st.dataframe(bottleneck_df, width="stretch", hide_index=True)
        fig = px.bar(
            bottleneck_df.head(12),
            x="score",
            y="area",
            orientation="h",
            color="score",
            color_continuous_scale=["#2A9D8F", "#E9C46A", "#E76F51"],
            title="Ranking de cuellos de botella",
        )
        fig.update_layout(yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig, width="stretch")

with tabs[4]:
    with st.spinner("Comparando escenarios predefinidos..."):
        scenario_df = pd.DataFrame(cached_compare(config)).sort_values("objetivo")
    st.dataframe(scenario_df, width="stretch", hide_index=True)
    fig = go.Figure()
    fig.add_trace(go.Bar(x=scenario_df["escenario"], y=scenario_df["boarding_p90_min"], name="Boarding ED P90"))
    fig.add_trace(go.Bar(x=scenario_df["escenario"], y=scenario_df["pacu_boarding_p90_min"], name="Bloqueo PACU P90"))
    fig.add_trace(go.Bar(x=scenario_df["escenario"], y=scenario_df["demora_alta_media_min"], name="Demora alta media"))
    fig.update_layout(barmode="group", title="Impacto operativo por escenario", xaxis_tickangle=-30)
    st.plotly_chart(fig, width="stretch")

with tabs[5]:
    budget = st.slider("Presupuesto relativo", 4.0, 28.0, 16.0, 1.0)
    with st.spinner("Buscando combinaciones de capacidad y politica..."):
        opt_df = pd.DataFrame(cached_optimize(config, budget)).head(15)
    st.dataframe(opt_df, width="stretch", hide_index=True)
    st.plotly_chart(
        px.scatter(
            opt_df,
            x="boarding_p90_min",
            y="ed_los_p90_min",
            size="recursos_saturados",
            color="escenario",
            hover_data=["objetivo", "principal_cuello"],
            title="Frontera practica de mejora",
        ),
        width="stretch",
    )

with tabs[6]:
    patient_df = pd.DataFrame(patient_records(result.patients))
    filters = st.columns(3)
    stream_filter = filters[0].multiselect("Flujo", sorted(patient_df["flujo"].unique()), default=sorted(patient_df["flujo"].unique()))
    severity_filter = filters[1].multiselect(
        "Gravedad", sorted(patient_df["gravedad"].unique()), default=sorted(patient_df["gravedad"].unique())
    )
    admitted_filter = filters[2].selectbox("Ingreso", ["Todos", "Ingresados", "No ingresados"])
    filtered = patient_df[patient_df["flujo"].isin(stream_filter) & patient_df["gravedad"].isin(severity_filter)]
    if admitted_filter == "Ingresados":
        filtered = filtered[filtered["ingresado"]]
    elif admitted_filter == "No ingresados":
        filtered = filtered[~filtered["ingresado"]]
    st.dataframe(filtered.sort_values("los_h", ascending=False).head(500), width="stretch", hide_index=True)

with tabs[7]:
    st.subheader("Cobertura del modelo")
    model_rows = pd.DataFrame(
        [
            {"bloque": "Arquitectura", "incluido": f"{config.architecture_name}; factores traslado {config.horizontal_travel_factor:.2f}x y ascensor {config.vertical_travel_factor:.2f}x"},
            {"bloque": "Urgencias", "incluido": "triaje, admision, boxes, medico, diagnostico, boarding"},
            {"bloque": "Hospitalizacion", "incluido": "ward/UCI, estancia, demora de alta, coordinacion de alta y recorridos verticales"},
            {"bloque": "Quirurgico", "incluido": "preop, quirofano, PACU, bloqueo por camas postoperatorias y distancia a camas"},
            {"bloque": "Soporte", "incluido": "laboratorio, imagen, farmacia, transporte interno"},
            {"bloque": "Politicas", "incluido": "alta temprana, surge protocol, camas dinamicas, escenarios"},
        ]
    )
    st.dataframe(model_rows, width="stretch", hide_index=True)
    st.code(repr(replace(config, capacities=config.resolved_capacities())), language="python")

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


BASE_GFA_SQM = 290_000


@dataclass(frozen=True)
class ProgramArea:
    category: str
    module: str
    area_sqm: int
    preferred_floors: str
    simulation_node: str
    notes: str


@dataclass(frozen=True)
class VerticalCore:
    core: str
    count: int
    serves: str
    separated_flow: str
    design_intent: str


@dataclass(frozen=True)
class Requirement:
    system: str
    item: str
    priority: str
    why: str
    simulation_hook: str


@dataclass(frozen=True)
class AdjacencyRule:
    origin: str
    target: str
    strength: str
    reason: str
    penalty: str


@dataclass(frozen=True)
class BenchmarkCapability:
    reference: str
    capability: str
    status: str
    why_it_matters: str
    design_response: str


@dataclass(frozen=True)
class ArchitectureOption:
    option: str
    archetype: str
    thesis: str
    tradeoffs: str
    blocks: tuple[dict[str, Any], ...]
    flows: tuple[dict[str, Any], ...]


BASE_PROGRAM = (
    ProgramArea("Clinico", "Urgencias y observacion", 13_000, "0", "ed", "Acceso ambulancias, triaje, boxes, observacion y area de crisis."),
    ProgramArea("Clinico", "Diagnostico por imagen", 12_000, "-1 / 0", "imaging", "TC/RM/radiologia/intervencionismo con acceso rapido desde ED, UCI y quirofano."),
    ProgramArea("Clinico", "Laboratorio clinico", 8_000, "-1", "lab", "Core lab, extracciones, microbiologia y respuesta urgente."),
    ProgramArea("Clinico", "Bloque quirurgico", 19_000, "1", "operating_room", "Quirofanos, induccion, apoyo anestesia, limpio/sucio y control ambiental."),
    ProgramArea("Clinico", "PACU / Reanimacion", 6_000, "1", "pacu", "Recuperacion inmediata conectada a quirofano, UCI y ward."),
    ProgramArea("Clinico", "UCI y cuidados intermedios", 11_000, "1", "icu_bed", "Criticos, aislamiento, control visual y conexion a diagnostico/OR."),
    ProgramArea("Clinico", "Hospitalizacion", 52_000, "2-6", "ward_bed", "Unidades repetibles, apoyo de enfermeria, aislamiento y crecimiento modular."),
    ProgramArea("Clinico", "Consultas externas / hospital de dia", 20_000, "0 / 1", "outpatient_clinician", "Alta rotacion, acceso publico separado y diagnostico cercano."),
    ProgramArea("Clinico", "Endoscopia / hemodinamica / intervencion", 6_000, "0 / 1", "operating_room", "Tratamiento de media complejidad con recuperacion corta."),
    ProgramArea("Clinico", "Rehabilitacion y terapias", 3_000, "0", "outpatient_clinician", "Acceso ambulatorio y continuidad post-alta."),
    ProgramArea("Soporte", "Farmacia", 7_000, "0 / -1", "pharmacy", "Dispensacion, preparacion, unidosis y conexion logistica."),
    ProgramArea("Soporte", "Esterilizacion / CSSD", 7_000, "-1 / 1", "transport", "Flujo sucio-lavado-esteril-almacen limpio conectado a quirofano."),
    ProgramArea("Soporte", "Logistica, muelles y almacenes", 10_000, "-1 / 0", "transport", "Recepcion, suministros, AGV/carros, residuos y distribucion."),
    ProgramArea("Soporte", "Cocina y nutricion", 6_000, "-1 / 0", "transport", "Produccion, dietas, carros y separacion de residuos."),
    ProgramArea("Soporte", "Lenceria y lavanderia", 3_000, "-1", "transport", "Circuito limpio/sucio y almacenamiento intermedio."),
    ProgramArea("Soporte", "Residuos y mortuorio", 4_000, "-1", "transport", "Salida discreta, segregacion y trazabilidad."),
    ProgramArea("Soporte", "Mantenimiento, electromedicina y talleres", 7_000, "-1 / cubierta", "transport", "Respuesta tecnica, repuestos y acceso MEP."),
    ProgramArea("Publico / Gestion", "Vestibulo, admision y atencion ciudadana", 11_000, "0", "registration", "Orientacion publica, espera, informacion y seguridad."),
    ProgramArea("Publico / Gestion", "Docencia, investigacion y simulacion clinica", 12_000, "0 / 1", "outpatient_clinician", "Auditorios, aulas, laboratorios secos y transferencia."),
    ProgramArea("Publico / Gestion", "Administracion y direccion", 7_000, "0 / superior", "registration", "Gestion, back office y salas de crisis."),
    ProgramArea("Publico / Gestion", "Areas de personal, guardias y vestuarios", 8_000, "-1 / 1", "transport", "Bienestar, descanso, guardias, vestuarios limpios/sucios."),
    ProgramArea("Infraestructura", "Circulacion horizontal comun", 18_000, "todas", "transport", "Pasillos publicos, clinicos, servicio y espera distribuida."),
    ProgramArea("Infraestructura", "Nucleos verticales y shafts", 8_000, "todas", "elevator", "Ascensores, escaleras, montacargas y patinillos."),
    ProgramArea("Infraestructura", "Plantas tecnicas MEP", 18_000, "-1 / cubierta", "transport", "HVAC, electricidad, gases medicinales, agua, datos y BMS."),
    ProgramArea("Infraestructura", "Seguridad, refugio y proteccion incendio", 5_000, "todas", "elevator", "Sectores, vestibulos, refugios, control incendios y evacuacion."),
    ProgramArea("Infraestructura", "Reserva de expansion / shell space", 9_000, "perimetro", "ward_bed", "Crecimiento futuro sin romper flujos principales."),
)

BENCHMARK_CAPABILITIES = (
    BenchmarkCapability(
        "Vall d'Hebron",
        "Hospital Infantil y Hospital de la Mujer como nodos casi autonomos",
        "Falta explicitar",
        "Un gran campus no funciona solo con ward generico: pediatria, obstetricia, neonatos y mujer tienen accesos, urgencias, quirofanos y UCI propios.",
        "Crear torre o bloque mujer-infantil con urgencias pediatrica/obstetrica, partos, neonatos, UCI pediatrica y hospitalizacion pediatrica.",
    ),
    BenchmarkCapability(
        "Vall d'Hebron",
        "Traumatologia, rehabilitacion y quemados de alta complejidad",
        "Falta explicitar",
        "El trauma grave requiere puerta de ambulancias, radiologia inmediata, quirofano contiguo, UCI, banco de sangre y rehabilitacion temprana.",
        "Anadir centro trauma-burns con shock rooms, imagen dedicada, quirofano de trauma, unidad de quemados y rehabilitacion conectada.",
    ),
    BenchmarkCapability(
        "Clínic / Vall d'Hebron",
        "Programas de trasplante y coordinacion de donacion",
        "Parcial",
        "Trasplantes cambian flujos: donante, receptor, laboratorio HLA, banco de sangre, quirofano urgente, UCI y seguimiento intensivo.",
        "Anadir coordinacion de trasplantes, HLA/inmunologia, banco tejidos, habitaciones protegidas y rutas OR-UCI-lab dedicadas.",
    ),
    BenchmarkCapability(
        "Clínic",
        "Terapias avanzadas, CAR-T y produccion celular GMP",
        "No contemplado",
        "CAR-T y terapia celular requieren aféresis, laboratorio GMP, criopreservacion, farmacia avanzada, hospital de dia y monitorizacion de toxicidad.",
        "Reservar unidad de terapias avanzadas con flujo muestra-producto-paciente, criobiologia, farmacia investigacional y camas de monitorizacion.",
    ),
    BenchmarkCapability(
        "Clínic / Vall d'Hebron",
        "Cancer center integral y medicina personalizada",
        "Parcial",
        "Un hospital terciario necesita oncologia medica, radioterapia, medicina nuclear, hospital de dia, ensayos fase I y molecular tumor board.",
        "Separar bloque oncohematologico con radioterapia, PET/nuclear, infusiones, consulta rapida, farmacia oncologica y ensayos.",
    ),
    BenchmarkCapability(
        "Clínic / Vall d'Hebron",
        "Institutos de investigacion, biobanco y plataformas cientificas",
        "Parcial",
        "IDIBAPS/VHIR/VHIO muestran que la investigacion no es un aula: requiere biobanco, animalario si aplica, plataformas genomica/citometria y laboratorios traslacionales.",
        "Convertir docencia-investigacion en campus translacional con biobanco, plataformas, laboratorios secos/humedos y acceso controlado a muestras.",
    ),
    BenchmarkCapability(
        "Clínic / Vall d'Hebron",
        "Ensayos clinicos fase I-IV y farmacia de investigacion",
        "Falta explicitar",
        "Los ensayos alteran agendas, medicacion, monitorizacion, muestras seriadas y circuitos regulatorios.",
        "Anadir clinical trials unit, CEIm/back office, salas de monitorizacion, archivo regulatorio y farmacia de ensayos.",
    ),
    BenchmarkCapability(
        "Vall d'Hebron",
        "Campus sanitario multi-institucion",
        "Parcial",
        "Vall d'Hebron funciona como campus: hospital, investigacion, docencia, innovacion y gestion; no solo edificio unico.",
        "Modelar parcelas/bloques: asistencial, investigacion, docencia, logistica, central energia, aparcamiento y conexiones exteriores.",
    ),
    BenchmarkCapability(
        "Clínic",
        "Salud internacional, enfermedades importadas y cooperacion/global health",
        "No contemplado",
        "Clínic integra ISGlobal/salud internacional; esto exige consultas, aislamiento, microbiologia y circuitos de viajero/infecciosas.",
        "Anadir unidad de salud internacional/infecciosas con aislamiento, toma de muestras segura y enlace a microbiologia.",
    ),
    BenchmarkCapability(
        "Clínic / Vall d'Hebron",
        "Centro de simulacion clinica avanzada",
        "Parcial",
        "La simulacion no es solo docencia; entrena crisis, quirófano, UCI, trauma y seguridad del paciente.",
        "Dimensionar centro de simulacion con mock OR/UCI/ED, salas briefing/debriefing y captura audiovisual.",
    ),
    BenchmarkCapability(
        "Clínic / Vall d'Hebron",
        "Centro de diagnostico biomédico ampliado",
        "Parcial",
        "El core lab generico no cubre anatomia patologica, inmunologia, microbiologia avanzada, genetica, biologia molecular y bioinformatica.",
        "Desglosar diagnostico biomédico por sublaboratorios y flujos muestra urgente/rutina/investigacion.",
    ),
    BenchmarkCapability(
        "Vall d'Hebron",
        "CSUR y unidades de referencia supra-territoriales",
        "Parcial",
        "La alta complejidad atrae pacientes externos, acompanantes, comites multidisciplinares y continuidad interautonomica.",
        "Crear capa CSUR: agenda multidisciplinar, admision externa, hotel/familias, telemedicina y seguimiento longitudinal.",
    ),
    BenchmarkCapability(
        "Hospitals terciarios",
        "Salud mental, crisis y enlace psiquiatrico",
        "Falta explicitar",
        "Urgencias y hospitalizacion necesitan boxes seguros, observacion psiquiatrica, interconsulta y rutas sin estigmatizar.",
        "Anadir urgencia psiquiatrica, hospital de dia, interconsulta, espacios seguros y separacion tranquila del ruido ED.",
    ),
    BenchmarkCapability(
        "Hospitals terciarios",
        "Centro de mando, telemedicina, datos e IA operacional",
        "Falta explicitar",
        "Un hospital nuevo debe operar con command center, ciberseguridad, integracion IoT/EHR y gemelo digital.",
        "Reservar command center, NOC/SOC, data center edge, salas de crisis y arquitectura de sensores.",
    ),
    BenchmarkCapability(
        "Hospitals terciarios",
        "Alojamiento familiar, hotel de pacientes y servicios de campus",
        "No contemplado",
        "Pacientes de referencia y pediatria generan estancias de familiares, trabajo social, mediacion y apoyo social.",
        "Anadir residencia/family house, espacios de descanso, trabajo social, voluntariado, mediacion y servicios no clinicos.",
    ),
)

ARCHITECTURE_OPTIONS = (
    ArchitectureOption(
        "Podio clinico + torres",
        "Hospital contemporaneo compacto",
        "Concentra diagnostico, urgencias, quirofano, UCI y logistica en un podio tecnico; hospitalizacion sube a torres repetibles.",
        "Muy eficiente en recorridos criticos, pero exige nucleos verticales potentes y buena segregacion publico-clinico-logistica.",
        (
            {"name": "Plaza sanitaria", "kind": "public", "x": 4, "y": 30, "w": 12, "h": 18, "floor": "0", "notes": "Llegada peatonal, taxis, bus, orientacion."},
            {"name": "Hall principal", "kind": "public", "x": 16, "y": 28, "w": 18, "h": 22, "floor": "0", "notes": "Atencion ciudadana, admision central, informacion."},
            {"name": "Esperas publicas", "kind": "waiting", "x": 16, "y": 50, "w": 18, "h": 9, "floor": "0-1", "notes": "Espera modular por consultas, pruebas y familiares."},
            {"name": "Consultas / hospital de dia", "kind": "ambulatory", "x": 34, "y": 42, "w": 18, "h": 17, "floor": "0-1", "notes": "Alta rotacion sin cruzar hospitalizacion."},
            {"name": "Urgencias", "kind": "emergency", "x": 34, "y": 14, "w": 17, "h": 20, "floor": "0", "notes": "Triaje, observacion, shock rooms, salud mental."},
            {"name": "Bahia ambulancias", "kind": "ambulance", "x": 51, "y": 14, "w": 11, "h": 12, "floor": "0", "notes": "Cubierta, descontaminacion, acceso catastrofe."},
            {"name": "Imagen / lab urgente", "kind": "diagnostic", "x": 52, "y": 30, "w": 13, "h": 14, "floor": "-1/0", "notes": "Acceso corto ED-UCI-OR."},
            {"name": "Quirofano + PACU", "kind": "surgery", "x": 65, "y": 28, "w": 15, "h": 18, "floor": "1", "notes": "Bloque limpio con recuperacion contigua."},
            {"name": "UCI / intermedios", "kind": "critical", "x": 80, "y": 28, "w": 11, "h": 18, "floor": "1", "notes": "Pegada a OR/PACU y ascensores clinicos."},
            {"name": "Torres hospitalizacion", "kind": "inpatient", "x": 60, "y": 48, "w": 27, "h": 16, "floor": "2-10", "notes": "Unidades repetibles, pediatria/mujer separable."},
            {"name": "Logistica / CSSD / farmacia", "kind": "logistics", "x": 64, "y": 8, "w": 24, "h": 13, "floor": "-1/0", "notes": "Muelle, esterilizacion, farmacia, residuos."},
            {"name": "Investigacion / docencia", "kind": "research", "x": 8, "y": 8, "w": 20, "h": 13, "floor": "0-4", "notes": "IDIBAPS/VHIR-style, simulacion clinica, aulas."},
            {"name": "Expansion", "kind": "future", "x": 90, "y": 48, "w": 8, "h": 16, "floor": "shell", "notes": "Reserva para crecimiento sin romper podio."},
        ),
        (
            {"name": "Publico", "from": (0, 39), "to": (16, 39), "kind": "public"},
            {"name": "Ambulancias", "from": (100, 20), "to": (62, 20), "kind": "ambulance"},
            {"name": "Logistica", "from": (100, 11), "to": (88, 14), "kind": "logistics"},
            {"name": "Clinico vertical", "from": (75, 46), "to": (75, 58), "kind": "clinical"},
        ),
    ),
    ArchitectureOption(
        "Campus por pabellones",
        "Modelo Vall d'Hebron / parque sanitario",
        "Separa grandes hospitales dentro de un campus: general, mujer-infantil, trauma-quemados, cancer center, investigacion y logistica.",
        "Muy resiliente y ampliable; penaliza traslados si los conectores, galerias y transporte interno no estan muy bien resueltos.",
        (
            {"name": "Boulevard publico", "kind": "public", "x": 6, "y": 32, "w": 88, "h": 10, "floor": "0", "notes": "Eje campus, orientacion, transporte publico."},
            {"name": "Hospital general", "kind": "inpatient", "x": 14, "y": 12, "w": 21, "h": 18, "floor": "0-9", "notes": "Medicina, cirugia, UCI adultos."},
            {"name": "Mujer-infantil", "kind": "maternal_child", "x": 39, "y": 10, "w": 20, "h": 20, "floor": "0-7", "notes": "Partos, neonatos, pediatria, urgencia pediatrica."},
            {"name": "Trauma / quemados", "kind": "emergency", "x": 63, "y": 10, "w": 21, "h": 20, "floor": "0-6", "notes": "Politrauma, quemados, rehabilitacion temprana."},
            {"name": "ED adulto + ambulancias", "kind": "ambulance", "x": 14, "y": 44, "w": 22, "h": 14, "floor": "0", "notes": "Puerta critica separada del boulevard publico."},
            {"name": "Cancer center", "kind": "oncology", "x": 39, "y": 45, "w": 18, "h": 13, "floor": "0-5", "notes": "Radioterapia, hospital de dia, ensayos fase I."},
            {"name": "Investigacion / biobanco", "kind": "research", "x": 61, "y": 45, "w": 18, "h": 13, "floor": "0-6", "notes": "VHIR/VHIO/IDIBAPS-style, plataformas."},
            {"name": "Logistica campus", "kind": "logistics", "x": 82, "y": 44, "w": 12, "h": 14, "floor": "-1/0", "notes": "Muelle central, residuos, cocina, CSSD."},
            {"name": "Halls y esperas", "kind": "waiting", "x": 17, "y": 33, "w": 64, "h": 8, "floor": "0", "notes": "Nodos de espera por edificio, comercio sanitario."},
            {"name": "Family house", "kind": "public", "x": 6, "y": 8, "w": 7, "h": 12, "floor": "0-4", "notes": "Alojamiento familiar y apoyo social."},
        ),
        (
            {"name": "Publico", "from": (0, 37), "to": (94, 37), "kind": "public"},
            {"name": "Ambulancias", "from": (0, 53), "to": (14, 51), "kind": "ambulance"},
            {"name": "Logistica", "from": (100, 51), "to": (94, 51), "kind": "logistics"},
            {"name": "Conector clinico", "from": (35, 25), "to": (84, 25), "kind": "clinical"},
        ),
    ),
    ArchitectureOption(
        "Espina clinica lineal",
        "Hospital de procesos",
        "Una espina diagnostico-terapeutica central conecta ED, imagen, OR, PACU, UCI y logistica; los bloques cuelgan de esa columna.",
        "Muy legible para optimizacion y expansiones por tramos; puede generar largos recorridos si la espina crece sin nodos intermedios.",
        (
            {"name": "Hall principal", "kind": "public", "x": 6, "y": 30, "w": 14, "h": 18, "floor": "0", "notes": "Entrada principal y orientacion."},
            {"name": "Galeria de esperas", "kind": "waiting", "x": 20, "y": 35, "w": 68, "h": 9, "floor": "0", "notes": "Esperas lineales por clinicas y pruebas."},
            {"name": "Espina diagnostico-terapeutica", "kind": "diagnostic", "x": 28, "y": 24, "w": 50, "h": 12, "floor": "-1/0/1", "notes": "Imagen, lab, endoscopia, intervencion, OR."},
            {"name": "Urgencias + ambulancias", "kind": "ambulance", "x": 20, "y": 9, "w": 20, "h": 13, "floor": "0", "notes": "Entra directo a espina diagnostica."},
            {"name": "Quirofano / PACU / UCI", "kind": "surgery", "x": 45, "y": 9, "w": 25, "h": 13, "floor": "1", "notes": "Nucleo caliente encima de diagnostico."},
            {"name": "Hospitalizacion adultos", "kind": "inpatient", "x": 22, "y": 48, "w": 24, "h": 15, "floor": "2-8", "notes": "Torre oeste."},
            {"name": "Mujer-infantil", "kind": "maternal_child", "x": 50, "y": 48, "w": 20, "h": 15, "floor": "2-7", "notes": "Torre este con urgencia propia."},
            {"name": "Onco/terapias avanzadas", "kind": "oncology", "x": 73, "y": 48, "w": 16, "h": 15, "floor": "0-5", "notes": "CAR-T, infusion, ensayos, radio/nuclear."},
            {"name": "Logistica subterranea", "kind": "logistics", "x": 79, "y": 14, "w": 14, "h": 19, "floor": "-1", "notes": "Muelle y AGV bajo espina."},
            {"name": "Investigacion", "kind": "research", "x": 6, "y": 8, "w": 12, "h": 15, "floor": "0-5", "notes": "Campus docente-investigador."},
        ),
        (
            {"name": "Publico", "from": (0, 39), "to": (88, 39), "kind": "public"},
            {"name": "Ambulancias", "from": (0, 15), "to": (20, 15), "kind": "ambulance"},
            {"name": "Logistica", "from": (100, 24), "to": (93, 24), "kind": "logistics"},
            {"name": "Espina clinica", "from": (28, 30), "to": (78, 30), "kind": "clinical"},
        ),
    ),
    ArchitectureOption(
        "Anillo con patios",
        "Hospital compacto con patios terapeuticos",
        "Un anillo publico-clinico rodea patios; el nucleo caliente queda en el centro y los bloques de hospitalizacion miran a luz natural.",
        "Buen equilibrio entre orientacion, luz, expansion y recorridos; exige separar muy bien el anillo publico del anillo logistico/clinico.",
        (
            {"name": "Gran hall / atrio", "kind": "public", "x": 13, "y": 24, "w": 18, "h": 20, "floor": "0", "notes": "Atrio de orientacion, admision, atencion ciudadana."},
            {"name": "Anillo de esperas", "kind": "waiting", "x": 31, "y": 24, "w": 38, "h": 20, "floor": "0-1", "notes": "Salas de espera alrededor de patios."},
            {"name": "Patios terapeuticos", "kind": "garden", "x": 38, "y": 30, "w": 24, "h": 8, "floor": "abierto", "notes": "Luz natural, orientacion, descanso."},
            {"name": "Nucleo caliente", "kind": "surgery", "x": 41, "y": 14, "w": 20, "h": 14, "floor": "-1/1", "notes": "Imagen, OR, PACU, UCI, lab urgente."},
            {"name": "Urgencias + ambulancias", "kind": "ambulance", "x": 70, "y": 16, "w": 18, "h": 16, "floor": "0", "notes": "Acceso lateral cubierto, descontaminacion."},
            {"name": "Hospitalizacion norte", "kind": "inpatient", "x": 18, "y": 7, "w": 20, "h": 13, "floor": "2-8", "notes": "Unidades adultas."},
            {"name": "Hospitalizacion sur", "kind": "inpatient", "x": 18, "y": 48, "w": 20, "h": 13, "floor": "2-8", "notes": "Unidades medicas y quirurgicas."},
            {"name": "Mujer-infantil", "kind": "maternal_child", "x": 64, "y": 45, "w": 20, "h": 15, "floor": "0-6", "notes": "Nodo propio con espera familiar."},
            {"name": "Investigacion/docencia", "kind": "research", "x": 5, "y": 8, "w": 11, "h": 16, "floor": "0-5", "notes": "Conexion campus y aulas."},
            {"name": "Logistica y MEP", "kind": "logistics", "x": 70, "y": 5, "w": 20, "h": 9, "floor": "-1/cubierta", "notes": "Muelle, MEP, CSSD, residuos."},
            {"name": "Expansion", "kind": "future", "x": 88, "y": 45, "w": 8, "h": 15, "floor": "shell", "notes": "Crecimiento mujer-infantil/onco."},
        ),
        (
            {"name": "Publico", "from": (0, 34), "to": (13, 34), "kind": "public"},
            {"name": "Ambulancias", "from": (100, 24), "to": (88, 24), "kind": "ambulance"},
            {"name": "Logistica", "from": (100, 9), "to": (90, 9), "kind": "logistics"},
            {"name": "Anillo clinico", "from": (31, 34), "to": (70, 34), "kind": "clinical"},
        ),
    ),
)

BASE_VERTICAL_CORES = (
    VerticalCore("Escaleras protegidas de evacuacion", 14, "Todas las plantas", "Emergencia", "Redundancia por sectores, evacuacion horizontal progresiva y salidas independientes."),
    VerticalCore("Escaleras de emergencia exteriores/sectorizadas", 6, "Torres y extremos de planta", "Emergencia", "Alternativa resiliente si un nucleo queda bloqueado."),
    VerticalCore("Ascensores publicos", 12, "Vestibulo, consultas y hospitalizacion", "Publico", "Evitar mezcla con camas, logistica y residuos."),
    VerticalCore("Ascensores clinicos cama/UCI/OR", 16, "ED, OR, PACU, UCI, ward, imagen", "Paciente encamado", "Reducir boarding, bloquear menos PACU y priorizar criticos."),
    VerticalCore("Montacargas limpios", 8, "CSSD, OR, farmacia, almacenes", "Limpio/esteril", "Separar material esteril de residuos y publico."),
    VerticalCore("Montacargas sucios/residuos", 8, "Ward, OR, laboratorio, residuos", "Sucio", "Control infeccion y rutas discretas."),
    VerticalCore("Nucleos tecnicos y shafts MEP", 10, "Todas las plantas", "Tecnico", "Mantenimiento sin invadir areas clinicas criticas."),
)

BASE_REQUIREMENTS = (
    Requirement("Evacuacion", "Escaleras protegidas y especialmente protegidas segun altura/uso", "Critico", "El uso hospitalario aloja pacientes que pueden no evacuar por si mismos.", "core_count, travel_distance, floor_id"),
    Requirement("Evacuacion", "Evacuacion horizontal progresiva entre sectores de incendio", "Critico", "En hospitales no se asume evacuacion total simultanea como unica estrategia.", "fire_sector_capacity"),
    Requirement("Evacuacion", "Vestibulos de independencia y control de humo en nucleos", "Critico", "Reduce paso de humo entre sectores, escaleras y ascensores.", "stairs, elevator_lobby"),
    Requirement("Emergencia", "Acceso ambulancias, bahia cubierta, descontaminacion y triaje de catastrofe", "Critico", "ED debe absorber picos y eventos masivos sin colapsar el acceso publico.", "ed_arrivals, surge_protocol"),
    Requirement("Emergencia", "Helipuerto o punto HEMS conectado a ED/OR/UCI", "Alto", "Traslados criticos requieren ruta vertical prioritaria.", "elevator_priority"),
    Requirement("Accesibilidad", "Itinerarios accesibles, ascensores y aseos accesibles", "Critico", "La accesibilidad no es opcional en un hospital publico.", "public_flow"),
    Requirement("Flujos", "Separacion publico, paciente encamado, personal, limpio, sucio y residuos", "Critico", "Evita cruces inseguros y mejora rendimiento logistico.", "flow_class"),
    Requirement("Infeccion", "Aislamientos, presiones diferenciales y rutas limpias/sucias", "Critico", "Protege UCI, OR, lab, urgencias y hospitalizacion.", "isolation_capacity"),
    Requirement("Quirurgico", "Bloque quirurgico con zonas limpia, restringida, apoyo y recuperacion", "Critico", "La actividad quirurgica exige estructura y circulaciones especificas.", "or_to_pacu_to_icu"),
    Requirement("Logistica", "Muelle, almacenes, farmacia, CSSD, residuos y mortuorio separados del publico", "Alto", "El hospital falla si la logistica invade rutas clinicas.", "service_flow"),
    Requirement("MEP", "Redundancia electrica, UPS, grupos, gases medicinales, HVAC y datos", "Critico", "UCI, OR, ED e imagen dependen de continuidad tecnica.", "downtime_scenario"),
    Requirement("Resiliencia", "Reserva de expansion, surge beds y shell space", "Alto", "Un hospital de 0 debe poder crecer sin rehacer su espina dorsal.", "capacity_scenario"),
)

BASE_ADJACENCIES = (
    AdjacencyRule("Urgencias", "Imagen / laboratorio urgente", "Dura", "Diagnostico temprano reduce boarding y decision de ingreso.", "minutos traslado ED-Dx"),
    AdjacencyRule("Urgencias", "UCI", "Fuerte", "Criticos deben subir sin atravesar publico.", "espera ascensor clinico"),
    AdjacencyRule("Urgencias", "Quirofano", "Fuerte", "Trauma/cirugia urgente necesita ruta rapida.", "tiempo ED-OR"),
    AdjacencyRule("Quirofano", "PACU", "Dura", "La recuperacion inmediata debe estar contigua.", "bloqueo OR/PACU"),
    AdjacencyRule("PACU", "UCI / ward", "Dura", "Cama postoperatoria disponible evita bloqueo de quirofano.", "pacu_boarding"),
    AdjacencyRule("Quirofano", "CSSD", "Fuerte", "Material esteril y retorno sucio requieren circuito propio.", "tiempo carro limpio/sucio"),
    AdjacencyRule("Hospitalizacion", "Ascensores clinicos", "Fuerte", "Pacientes encamados necesitan capacidad vertical estable.", "elevator_wait"),
    AdjacencyRule("Farmacia", "Logistica / ward", "Media", "Distribucion unidosis y medicacion alta frecuencia.", "tiempo dispensacion"),
    AdjacencyRule("Residuos / mortuorio", "Publico", "Separar", "Rutas discretas y control sanitario.", "cruce flujo publico"),
    AdjacencyRule("Consultas externas", "Vestibulo publico", "Fuerte", "Alta rotacion ambulatoria sin invadir hospitalizacion.", "congestion publico"),
    AdjacencyRule("MEP critico", "UCI / OR / imagen", "Fuerte", "Mantenimiento y redundancia cerca sin interrumpir actividad.", "downtime risk"),
)


def build_master_plan(total_gfa_sqm: int = BASE_GFA_SQM) -> dict[str, Any]:
    scale = total_gfa_sqm / BASE_GFA_SQM
    program = [
        {
            "categoria": area.category,
            "modulo": area.module,
            "m2": round(area.area_sqm * scale),
            "%": round(area.area_sqm * scale / total_gfa_sqm * 100, 1),
            "plantas_preferentes": area.preferred_floors,
            "nodo_simulacion": area.simulation_node,
            "notas": area.notes,
        }
        for area in BASE_PROGRAM
    ]
    return {
        "total_gfa_sqm": total_gfa_sqm,
        "program": program,
        "vertical_cores": [core.__dict__ for core in BASE_VERTICAL_CORES],
        "requirements": [requirement.__dict__ for requirement in BASE_REQUIREMENTS],
        "adjacencies": [adjacency.__dict__ for adjacency in BASE_ADJACENCIES],
        "benchmark_capabilities": [capability.__dict__ for capability in BENCHMARK_CAPABILITIES],
        "architecture_options": [
            {
                "option": option.option,
                "archetype": option.archetype,
                "thesis": option.thesis,
                "tradeoffs": option.tradeoffs,
                "blocks": list(option.blocks),
                "flows": list(option.flows),
            }
            for option in ARCHITECTURE_OPTIONS
        ],
        "category_summary": _category_summary(program),
    }


def _category_summary(program: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, int] = {}
    for row in program:
        totals[row["categoria"]] = totals.get(row["categoria"], 0) + int(row["m2"])
    grand_total = sum(totals.values()) or 1
    return [
        {"categoria": category, "m2": area, "%": round(area / grand_total * 100, 1)}
        for category, area in totals.items()
    ]

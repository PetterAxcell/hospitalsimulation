# Mezcla clinica desde MIMIC-IV

El simulador no inventa la mezcla de pacientes si le das datos reales. El script
`frontend/scripts/mimic-to-cases.mjs` lee una extraccion de MIMIC-IV y escribe el
YAML de casos clinicos que la pestana Simulacion ya sabe cargar.

## Acceso a los datos

MIMIC-IV es de acceso credencializado en PhysioNet: hay que completar la
formacion CITI y firmar el acuerdo de uso. La version demo (100 pacientes) es
abierta y sirve para probar todo el circuito. El script **no descarga nada**:
trabaja sobre CSV que ya tengas en disco.

Rutas esperadas (acepta `.csv` y `.csv.gz`, y tambien todos los ficheros juntos
en una sola carpeta):

```text
mimic-iv/
  hosp/admissions.csv        obligatorio (o ed/edstays.csv)
  hosp/diagnoses_icd.csv     cohortes por capitulo diagnostico
  hosp/procedures_icd.csv    imagen y quirofano
  hosp/labevents.csv         opcional, solo con --labs
  icu/icustays.csv           probabilidad y estancia de UCI
  ed/edstays.csv             llegada (ambulancia / a pie) y perfil horario
  ed/triage.csv              acuity para la gravedad
```

## Uso

```bash
cd frontend
npm run cases:mimic -- --input /ruta/mimic-iv \
  --out casos-mimic.yaml \
  --stats mimic-stats.json \
  --label "MIMIC-IV-ED 2.2 demo" \
  --top 8
```

Opciones: `--top` cohortes maximas, `--min` episodios minimos por cohorte,
`--labs` para medir la probabilidad real de analitica recorriendo `labevents`
(es el fichero mas grande del dataset).

Despues, en la app: pestana **Simulacion** → `Plantilla de casos` → subir
`casos-mimic.yaml` → `Guardar casos`. El panel muestra la procedencia y el
escenario que guardes en el Planificador queda etiquetado con ella.

## Que se deriva de los datos

| Elemento del caso | Origen en MIMIC |
| --- | --- |
| Cohorte | Capitulo del diagnostico principal (`diagnoses_icd.seq_num = 1`), ICD-9 y ICD-10 |
| Peso (`weight`) | Frecuencia relativa de episodios de la cohorte |
| Flujo (`stream`) | `edstays.arrival_transport` (ambulancia / a pie) y `admissions.admission_type` (programado) |
| Gravedad (`severity`) | Media de `triage.acuity`; sin ED, proporcion de UCI y mortalidad hospitalaria |
| Probabilidad de imagen | Procedimientos de la seccion B en ICD-10-PCS, 87-88 en ICD-9-CM |
| Probabilidad de quirofano | Procedimientos de la seccion 0 en ICD-10-PCS, 01-86 en ICD-9-CM |
| Probabilidad de UCI | Ingresos con `icustays` sobre el total de la cohorte |
| Destino final | UCI / planta / alta segun proporcion de ingreso y de UCI |
| Probabilidad de analitica | `labevents` con `--labs`; sin la opcion, supuesto por tipo de recorrido |
| Llegadas/h sugeridas | Episodios por dia de calendario cubierto, en `--stats` |

## Limites conocidos

- Los tiempos de servicio y de traslado siguen siendo los del motor. Las medianas
  de estancia hospitalaria y de UCI se calculan y se guardan en `--stats`, pero
  el motor todavia no consume duraciones por nodo.
- El perfil horario de llegadas se mide y se reporta, pero la simulacion reparte
  las llegadas de forma uniforme dentro del ciclo.
- La cohorte se decide por capitulo diagnostico, no por DRG ni por motivo de
  consulta. Es una agrupacion gruesa: util para mezcla y adyacencias, insuficiente
  para conclusiones clinicas.
- Sin `--labs`, la probabilidad de analitica es un supuesto declarado en
  `meta.notes` del YAML generado.
- MIMIC describe un hospital academico de Boston. Trasladar su mezcla a otro
  sistema sanitario exige calibrar con datos locales.

## Equivalente en BigQuery

Si trabajas con MIMIC en BigQuery en lugar de CSV, esta consulta produce la
tabla que el script construye en memoria; expórtala a CSV y pásala con
`--input`:

```sql
SELECT
  a.hadm_id,
  a.admittime,
  a.dischtime,
  a.admission_type,
  a.hospital_expire_flag,
  d.icd_code,
  d.icd_version,
  e.arrival_transport,
  t.acuity,
  i.los AS icu_los
FROM `physionet-data.mimiciv_hosp.admissions` a
LEFT JOIN `physionet-data.mimiciv_hosp.diagnoses_icd` d
  ON d.hadm_id = a.hadm_id AND d.seq_num = 1
LEFT JOIN `physionet-data.mimiciv_ed.edstays` e ON e.hadm_id = a.hadm_id
LEFT JOIN `physionet-data.mimiciv_ed.triage` t ON t.stay_id = e.stay_id
LEFT JOIN `physionet-data.mimiciv_icu.icustays` i ON i.hadm_id = a.hadm_id
```

## Verificacion

`npm run verify:scenarios -- --cases casos-mimic.yaml` comprueba en Chrome
headless que el YAML se aplica y que la simulacion pasa a usar esas cohortes.

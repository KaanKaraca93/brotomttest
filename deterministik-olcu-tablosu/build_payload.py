"""
StyleMeasurement Payload Builder
Input : deterministik-olcu-tablosu/input   (PLM GradeRule API response + styleId/moduleCode)
Output: deterministik-olcu-tablosu/output  (StyleMeasurement POST payload)
"""

import json
import time
import base64
from pathlib import Path

# ── Sabitler ──────────────────────────────────────────────────────────────────
MODIFY_ID   = 124
SETTING_FORMAT = 2          # PLM'de sabit
FRAC_DENOM_LOOKUP_TO_VALUE = {1: 8, 2: 16, 3: 32}  # PLM lookup Id → gerçek pay

# ── TempKey üretimi ───────────────────────────────────────────────────────────
_BASE_TS = int(time.time() * 1000)

def make_temp_key(suffix: str) -> str:
    raw = str(_BASE_TS).encode()
    return base64.b64encode(raw).decode() + str(suffix)

# ── GradeMeas hesabı (kümülatif) ──────────────────────────────────────────────
def calc_grade_meas(pom_sizes: list, grade_rule_sizes: list, sample_size_id: int):
    """
    Her GradeRulePomSize için GradeMeas hesaplar.
    Referans beden (SampleSizeId eşleşen GradeRuleSize) → GradeMeas = 0.
    Diğer bedenleri sıraya göre kümülatif toplarız.
    Şu anki input'ta tek beden var, hepsi 0.
    """
    # GradeRuleSizeId → SizeId, Seq lookup
    size_map = {s["Id"]: s for s in grade_rule_sizes}

    # Referans bedenin GradeRuleSizeId'sini bul
    ref_gr_size_id = next(
        (s["Id"] for s in grade_rule_sizes if s["SizeId"] == sample_size_id),
        None
    )

    # Sıraya göre sırala
    sorted_sizes = sorted(grade_rule_sizes, key=lambda s: s["Seq"])
    ref_index = next(
        (i for i, s in enumerate(sorted_sizes) if s["Id"] == ref_gr_size_id),
        0
    )

    # Her beden için kümülatif GradeMeas hesapla
    meas_by_gr_size_id = {}
    for ps in pom_sizes:
        gr_size_id = ps["GradeRuleSizeId"]
        size_info  = size_map.get(gr_size_id, {})
        idx        = next((i for i, s in enumerate(sorted_sizes) if s["Id"] == gr_size_id), ref_index)

        if idx == ref_index:
            grad_dec  = 0.0
            grad_met  = 0.0
            grad_frac = "0"
        elif idx < ref_index:
            # Referansa kadar geriye topla → negatif
            total_dec = 0.0
            total_met = 0.0
            for j in range(idx, ref_index):
                s_id = sorted_sizes[j]["Id"]
                matching = next((p for p in pom_sizes if p["GradeRuleSizeId"] == s_id), None)
                if matching:
                    total_dec += matching["GradeIncDecimal"]
                    total_met += matching["GradeIncMetric"]
            grad_dec  = -total_dec
            grad_met  = -total_met
            grad_frac = ps.get("GradeIncFraction", "0")
        else:
            # Referanstan ileri topla → pozitif
            total_dec = 0.0
            total_met = 0.0
            for j in range(ref_index, idx):
                s_id = sorted_sizes[j + 1]["Id"]
                matching = next((p for p in pom_sizes if p["GradeRuleSizeId"] == s_id), None)
                if matching:
                    total_dec += matching["GradeIncDecimal"]
                    total_met += matching["GradeIncMetric"]
            grad_dec  = total_dec
            grad_met  = total_met
            grad_frac = ps.get("GradeIncFraction", "0")

        meas_by_gr_size_id[gr_size_id] = {
            "GradeMeasDecimal": grad_dec,
            "GradeMeasMetric":  grad_met,
            "GradeMeasFraction": grad_frac,
        }

    return meas_by_gr_size_id


# ── Ana builder ───────────────────────────────────────────────────────────────
def build_payload(input_path: str, output_path: str):
    raw = Path(input_path).read_text(encoding="utf-8-sig")
    data = json.loads(raw)

    style_id    = data["styleId"]
    module_code = data["moduleCode"]

    # GradeRule entity'sini bul
    gr_entity = next(e for e in data["entities"] if e["name"] == "GradeRule")
    gr = gr_entity["column"]

    grade_rule_id       = gr["Id"]
    grade_rule_name     = gr["Name"]
    size_range_id       = gr["SizeRangeId"]
    sample_size_id      = gr["SampleSizeId"]
    tolerance_format    = gr["ToleranceFormat"]
    grade_rule_format   = gr["GradeRuleFormat"]
    measurement_view    = gr["MeasurementView"]
    num_scale           = gr.get("NumScale", 0)
    frac_denom_raw      = gr.get("FractionDenominator", 2)
    frac_denom_val      = FRAC_DENOM_LOOKUP_TO_VALUE.get(frac_denom_raw, 16)

    poms         = gr["GradeRulePom"]
    gr_sizes     = gr["GradeRuleSizes"]

    # Bedenlere TempKey ata (sıraya göre)
    sorted_gr_sizes = sorted(gr_sizes, key=lambda s: s["Seq"])
    size_temp_keys  = {}
    for i, s in enumerate(sorted_gr_sizes):
        size_temp_keys[s["Id"]] = make_temp_key(i)

    # ── SubEntities listesi ───────────────────────────────────────────────────
    sub_entities = []

    # 1) StyleMeasurementSizes
    for i, s in enumerate(sorted_gr_sizes):
        sub_entities.append({
            "Key": 0,
            "TempKey": size_temp_keys[s["Id"]],
            "SubEntity": "StyleMeasurementSizes",
            "FieldValues": [
                {"FieldName": "Seq",    "Value": s["Seq"]},
                {"FieldName": "SizeId", "Value": s["SizeId"]},
            ]
        })

    # 2) StyleMeasurementPom
    sorted_poms = sorted(poms, key=lambda p: p["Seq"])
    for pi, pom in enumerate(sorted_poms):
        pom_temp_key = make_temp_key(f"p{pi}")

        # GradeMeas hesapla bu POM için
        meas_map = calc_grade_meas(pom["GradeRulePomSizes"], gr_sizes, sample_size_id)

        # PomSize SubEntities
        pom_size_subs = []
        for si, ps in enumerate(pom["GradeRulePomSizes"]):
            gr_size_id = ps["GradeRuleSizeId"]
            meas       = meas_map.get(gr_size_id, {"GradeMeasDecimal": 0, "GradeMeasMetric": 0, "GradeMeasFraction": "0"})
            pom_size_subs.append({
                "Key": 0,
                "TempKey": make_temp_key(f"p{pi}s{si}"),
                "SubEntity": "StyleMeasurementPomSizes",
                "FieldValues": [
                    {"FieldName": "StyleMeasurementSizeId", "Value": size_temp_keys[gr_size_id]},
                    {"FieldName": "GradeIncDecimal",        "Value": ps["GradeIncDecimal"]},
                    {"FieldName": "GradeIncMetric",         "Value": ps["GradeIncMetric"]},
                    {"FieldName": "GradeIncFraction",       "Value": ps["GradeIncFraction"]},
                    {"FieldName": "GradeMeasDecimal",       "Value": meas["GradeMeasDecimal"]},
                    {"FieldName": "GradeMeasMetric",        "Value": meas["GradeMeasMetric"]},
                    {"FieldName": "GradeMeasFraction",      "Value": meas["GradeMeasFraction"]},
                    {"FieldName": "InitMeasDecimal",        "Value": 0},
                    {"FieldName": "InitMeasMetric",         "Value": 0},
                    {"FieldName": "InitMeasFraction",       "Value": 0},
                    {"FieldName": "Init_MeasDecimal",       "Value": meas["GradeMeasDecimal"]},
                    {"FieldName": "Init_MeasMetric",        "Value": meas["GradeMeasMetric"]},
                    {"FieldName": "Init_MeasFraction",      "Value": meas["GradeMeasFraction"]},
                    {"FieldName": "IsDeleted",              "Value": 0},
                ]
            })

        # POM CultureInfos
        culture_infos = pom.get("Pom", {}).get("POMCultureInfos", [])

        pom_field_values = [
            {"FieldName": "Priority",              "Value": pom["Priority"]},
            {"FieldName": "Seq",                   "Value": pom["Seq"]},
            {"FieldName": "PomCode",               "Value": pom["PomCode"]},
            {"FieldName": "PomName",               "Value": pom["PomName"]},
            {"FieldName": "GradeRuleName",         "Value": grade_rule_name},
            {"FieldName": "Description",           "Value": pom.get("Description", "")},
            {"FieldName": "Status",                "Value": 1},
            {"FieldName": "OperationalStatus",     "Value": 1},
            {"FieldName": "PartId"},
            {"FieldName": "Image"},
            {"FieldName": "TolerancePlus"},
            {"FieldName": "ToleranceMinus"},
            {"FieldName": "StandardIncrement"},
            {"FieldName": "InitialMeasurement"},
            {"FieldName": "PomId",                 "Value": pom["PomId"]},
            {"FieldName": "IsOnTheFly"},
            {"FieldName": "GradeRuleId",           "Value": grade_rule_id},
            {"FieldName": "TolerancePlusFraction", "Value": pom.get("TolerancePlusFraction", "0")},
            {"FieldName": "TolerancePlusMetric",   "Value": pom.get("TolerancePlusMetric", 0)},
            {"FieldName": "TolerancePlusDecimal",  "Value": pom.get("TolerancePlusDecimal", 0)},
            {"FieldName": "ToleranceMinusFraction","Value": pom.get("ToleranceMinusFraction", "0")},
            {"FieldName": "ToleranceMinusMetric",  "Value": pom.get("ToleranceMinusMetric", 0)},
            {"FieldName": "ToleranceMinusDecimal", "Value": pom.get("ToleranceMinusDecimal", 0)},
            {"FieldName": "RevMeasFraction",       "Value": "0"},
            {"FieldName": "RevMeasMetric",         "Value": "0"},
            {"FieldName": "RevMeasDecimal",        "Value": "0"},
            {"FieldName": "IsDeleted",             "Value": 0},
            {"FieldName": "ImageOFileName"},
            {"FieldName": "StandardIncrementFraction", "Value": pom.get("StandardIncrementFraction", "0")},
            {"FieldName": "StandardIncrementMetric",   "Value": pom.get("StandardIncrementMetric", 0)},
            {"FieldName": "StandardIncrementDecimal",  "Value": pom.get("StandardIncrementDecimal", 0)},
            {"FieldName": "InitMeasDec"},
            {"FieldName": "InitMeasFrac"},
            {"FieldName": "InitMeasMet"},
            {"FieldName": "NameCulture"},
            {"FieldName": "DescriptionCulture"},
            {"FieldName": "ImageCustom"},
            {"FieldName": "ImageThumb"},
            {"FieldName": "POMCultureInfos", "Value": culture_infos},
        ]

        sub_entities.append({
            "Key": 0,
            "TempKey": pom_temp_key,
            "SubEntity": "StyleMeasurementPom",
            "FieldValues": pom_field_values,
            "SubEntities": pom_size_subs,
        })

    # ── Ana payload ───────────────────────────────────────────────────────────
    payload = {
        "StyleId":        style_id,
        "Key":            0,
        "IsMain":         1,
        "ModuleCode":     module_code,
        "ModuleName":     module_code,
        "StyleStatus":    1,
        "SizeRangeId":    size_range_id,
        "ModifyId":       str(MODIFY_ID),
        "RowVersionText": "",
        "DefaultImageId": None,
        "MainImgsDto":    [],
        "FieldValues": [
            {"FieldName": "IsMain",             "Value": 1},
            {"FieldName": "StyleId",            "Value": style_id},
            {"FieldName": "SizeRangeId",        "Value": size_range_id},
            {"FieldName": "ToleranceFormat",    "Value": tolerance_format},
            {"FieldName": "Status",             "Value": 1},
            {"FieldName": "SettingFormat",      "Value": SETTING_FORMAT},
            {"FieldName": "GradeRuleFormat",    "Value": grade_rule_format},
            {"FieldName": "MeasurementView",    "Value": measurement_view},
            {"FieldName": "FractionDenominator","Value": frac_denom_val},
            {"FieldName": "NumScale",           "Value": num_scale},
            {"FieldName": "RowVersionText",     "Value": ""},
            {"FieldName": "InitSampSizeId",     "Value": 0},
            {"FieldName": "ModifyId",           "Value": 0},
            {"FieldName": "SampleSizeId",       "Value": sample_size_id},
        ],
        "SubEntities": sub_entities,
    }

    Path(output_path).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    # Ozet
    size_count = len(gr_sizes)
    pom_count  = len(poms)
    print(f"[OK] Payload olusturuldu: {output_path}")
    print(f"   GradeRule     : [{grade_rule_id}] {grade_rule_name}")
    print(f"   StyleId       : {style_id}")
    print(f"   ModuleCode    : {module_code}")
    print(f"   Beden sayisi  : {size_count}")
    print(f"   POM sayisi    : {pom_count}")
    print(f"   SubEntity top : {len(sub_entities)}")



# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    base = Path(__file__).parent
    build_payload(
        input_path  = str(base / "input"),
        output_path = str(base / "output"),
    )

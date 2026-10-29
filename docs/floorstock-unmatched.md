# Floor stock rows to check

Generated 2026-10-29 by `npm run cli -- import-floorstock` from the 2026 "Senarai Floor Stock" PDFs.
Unmatched rows are stored with no formulary item, so they show on no drug screen. Fix the name in the PDF or add the item to MASTER, then re-import that unit.
Low-confidence matches are used as par levels; confirm each one.

| Unit | Parsed | Matched | Unmatched | Low confidence |
| --- | ---: | ---: | ---: | ---: |
| ETD | 152 | 149 | 3 | 1 |
| Female Ward | 175 | 166 | 9 | 1 |
| HDU | 41 | 40 | 1 | 0 |
| ICU | 191 | 184 | 7 | 2 |
| Klinik Mata | 15 | 15 | 0 | 0 |
| Klinik Pakar | 12 | 12 | 0 | 0 |
| Klinik Psikiatrik | 22 | 22 | 0 | 0 |
| Male Ward | 178 | 170 | 8 | 2 |
| Maternity Ward | 126 | 123 | 3 | 1 |
| OPD MO Room | 11 | 11 | 0 | 0 |
| OT | 104 | 102 | 2 | 2 |
| Paeds Ward | 91 | 87 | 4 | 1 |
| Treatment Room | 24 | 23 | 1 | 1 |
| Unit Endoscopy | 55 | 52 | 3 | 0 |
| Unit Radiology | 17 | 17 | 0 | 0 |

## Unmatched rows

| Unit | List | Item in PDF | SKU | Max |
| --- | --- | --- | --- | ---: |
| ETD | Floor stock | Green Pit Viper Antivenom** | vial | 3 |
| ETD | Floor stock | Human Albumin 20% (10g in 50ml) | vial | 3 |
| ETD | After office hours | Liquid Paraffin | ml | 200 |
| Female Ward | Floor stock | Liquid Paraffin | ml | 50 |
| Female Ward | Floor stock | Sodium Chloride 1g/10ml Oral Solution (1.71mmol/ml) | ml | 400 |
| Female Ward | Floor stock | Sodium Citrate, Citric Acid Mixture 3 g/10 ml | ml | 200 |
| Female Ward | Floor stock | Erythropoietin Beta Human Recombinant 2000 IU Injection | PFsy | 6 |
| Female Ward | Floor stock | Insulin Recombinant Synthetic Human, Premixed (Diabulyn-30/70) 100 IU/mL Penfill | penfill | 1 |
| Female Ward | Psychotropic & DDA | Morphine HCl 10 mg/5 ml Solution | ml | 200 |
| Female Ward | After office hours | Quinine Sulphate 300 mg Tablet | tab | 10 |
| Female Ward | After office hours | Calcium Polystyrene Sulphonate Powder, 5g/sachet | sachet | 10 |
| Female Ward | After office hours | Gemeprost (Prostagladin E1) 1 mg Pessary | pessary | 1 |
| HDU | Floor stock | Erythropoietin Beta Human Recombinant 2000 IU Injection | PFsy | 180 |
| ICU | Floor stock | Liquid Paraffin | ml | 50 |
| ICU | Floor stock | Sodium Chloride 1g/10ml Oral Solution (1.71mmol/ml) | ml | 400 |
| ICU | Floor stock | Sodium Citrate, Citric Acid Mixture 3 g/10 ml | ml | 200 |
| ICU | Floor stock | Erythropoietin Beta Human Recombinant 2000 IU Injection | PFsy | 6 |
| ICU | Psychotropic & DDA | Morphine HCl 10 mg/5 ml Solution | ml | 200 |
| ICU | After office hours | Calcium Polystyrene Sulphonate Powder, 5g/sachet | sachet | 10 |
| ICU | After office hours | Zinc Oxide Cream (15%) | g | 30 |
| Male Ward | Floor stock | Liquid Paraffin | ml | 50 |
| Male Ward | Floor stock | Sodium Chloride 1g/10ml Oral Solution (1.71mmol/ml) | ml | 400 |
| Male Ward | Floor stock | Sodium Citrate, Citric Acid Mixture 3 g/10 ml | ml | 200 |
| Male Ward | Floor stock | Erythropoietin Beta Human Recombinant 2000 IU Injection | PFsy | 6 |
| Male Ward | Floor stock | Insulin Recombinant Synthetic Human, Premixed (Diabulyn-30/70) 100 IU/mL Penfill | penfill | 1 |
| Male Ward | Psychotropic & DDA | Morphine HCl 10 mg/5 ml Solution | ml | 200 |
| Male Ward | After office hours | Quinine Sulphate 300 mg Tablet | tab | 10 |
| Male Ward | After office hours | Calcium Polystyrene Sulphonate Powder, 5g/sachet | sachet | 10 |
| Maternity Ward | Floor stock | Sodium Chloride 1g/10ml Oral Solution (1.71mmol/ml) | ml | 200 |
| Maternity Ward | Floor stock | Sodium Citrate, Citric Acid Mixture 3 g/10 ml | ml | 200 |
| Maternity Ward | After office hours | Gemeprost (Prostagladin E1) 1 mg Pessary | pessary | 2 |
| OT | Floor stock | Levobupivacaine 5mg/ml Injection | amp | 30 |
| OT | Floor stock | Methylene Blue 1% Injection | amp | 10 |
| Paeds Ward | Floor stock | Magnesium, Aluminium Hydroxide and Simethicone Suspension | ml | 200 |
| Paeds Ward | Floor stock | Sucrose 23% oral solution | ml | 35 |
| Paeds Ward | After office hours | Levetiracetam 100mg/ml Injection (5ml amp/vial) | vial | 2 |
| Paeds Ward | After office hours | Magnesium Sulphate 50% Injection | amp | 4 |
| Treatment Room | Floor stock | Erythropoietin Beta Human Recombinant 2000 IU Injection | PFsy | 18 |
| Unit Endoscopy | Floor stock | Liquid Paraffin | ml | 200 |
| Unit Endoscopy | Floor stock | Polyethylene Glycol /Macrogol 4000 Powder | sachet | 8 |
| Unit Endoscopy | Floor stock | Methylene Blue 1% Injection | amp | 2 |

## Matches to confirm

Exact name matches are not listed. "high" is a token similarity of 0.8 or more with identical strengths; "low" is 0.6 to 0.8.

| Unit | Item in PDF | Matched formulary item | No Kod | Confidence |
| --- | --- | --- | --- | --- |
| ETD | Insulin regular (Actrapid) 100 IU/mL Vial | Insulin regular (Actrapid/Insugen R) 100 IU/mL Vial | 07.1608.01 | low 0.73 |
| ETD | Artificial Tears/Eye Lubricant Ophthalmic Solution | Artificial Tears/Eye Lubricant Opthalmic Solution (With Preservative) | S01XA20000D20XX | high 0.83 |
| ETD | Bisoprolol Fumarate 2.5 mg Tablet | Bisoprolol 2.5mg Tablet | C07AB07000T1001XX | high 0.86 |
| ETD | Cloxacillin Sodium 500 mg Injection | Cloxacillin 500mg Inj | 07.0406.21 | high 0.86 |
| ETD | Sodium Bicarbonate, Citric Acid, Sodium Citrate and Tartaric Acid 4g/sachet (Ural) | Sodium Bicarbonate, Citric Acid, Sodium Citrate, Tartaric Acid 4g/sachet | B05CB10955M4001XX | high 0.88 |
| ETD | Glyceryl Trinitrate 0.5 mg Sublingual Tablet | Glyceryl Trinitrate 0.5 mg Tablet | 02.1202.02 | high 0.89 |
| ETD | Piperacillin 4 g & Tazobactam 500 mg Injection | Piperacillin 4g + Tazobactam 500mg Injection | J01CR05961P3001XX | high 0.91 |
| Female Ward | Felodipine 10 mg ER Tablet | Felodipine 10 mg Tablet | C08CA02000T1002XX | high 0.86 |
| Female Ward | Vildagliptin 50 mg Tablet | Vildagliptin (Galvus) 50mg Tablet | A10BH02000T1001XX | high 0.86 |
| Female Ward | Pre/Post Natal Vitamin & Mineral Capsule | Pre/Post-Natal Vitamin and Mineral Capsule | A11AA03903C1001XX | high 0.91 |
| HDU | Methoxy Polyethylene Glycol Epoetin Beta 100mcg/0.3 ml Inj | Methoxy Polyethylene Glycol-epoetin Beta 100mcg/0.3mL Injection in Prefilled Syringe | B03XA03000P5001XX | high 0.82 |
| ICU | Hydrocortisone 100mg Injection | Hydrocortisone Sodium Succinate 100mg Injection | 03.1403.07 | low 0.75 |
| ICU | Esmolol HCl 10 mg/ml Injection (10ml amp/vial) | Esmolol HCl 10mg/ml Injection | C07AB09110P3001XX.01 | high 0.8 |
| ICU | Sulphamethoxazole 400 mg & Trimethoprim 80 mg Tablet (Bactrim) | Sulphamethoxazole 400 mg Trimethoprim 80 mg Tablet | 07.3602.01 | high 0.91 |
| Male Ward | Gliclazide 30mg MR Tablet | Gliclazide 30 mg Modified Release Tablet | A10BB09000T5002XX | low 0.67 |
| Maternity Ward | Diclofenac 25mg Suppository | Diclofenac Sodium 25 mg Suppository | M01AB05520S2002XX | high 0.86 |
| OT | Bupivacaine 0.5 % with Adrenaline 1:200,000 Injection | Bupivacaine 0.5%+Adrenaline 1:200,000 Inj | 03.0204.03 | low 0.67 |
| OT | Oxytocin 5 units & Ergometrine Maleate 0.5mg/ml Injection | Oxytocin 5U + Ergometrine 0.5mg/ml Inj | 03.0802.03 | low 0.67 |
| OT | Diclofenac 25 mg Suppository | Diclofenac Sodium 25 mg Suppository | M01AB05520S2002XX | high 0.86 |
| OT | Lidocaine 25mg, Prilocaine 25mg Cream | Lidocaine 25mg and Prilocaine 25mg Cream | N01BB52974G1001XX | high 0.89 |
| Paeds Ward | Mefenamic Acid 250 mg Tablet/Capsule | Mefenamic Acid 250 mg Capsule | 02.2403.01 | low 0.75 |
| Treatment Room | Lidocaine 25mg, Prilocaine 25mg Cream (EMLA) | Lidocaine 25mg and Prilocaine 25mg Cream | N01BB52974G1001XX | high 0.8 |

## Rows with no quantity

- Klinik Pakar: No approved quantity for "Dextrose 50% 10 ml Injection"

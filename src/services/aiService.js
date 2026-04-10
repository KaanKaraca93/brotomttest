'use strict';

require('dotenv').config();
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Style verisini ve GradeRule listesini kullanarak
 * yapay zekaya en uygun GradeRule'u seçtirir.
 *
 * @param {Object} styleData    - PLM'den gelen Style API response (value[0])
 * @param {Array}  gradeRules   - PLM'den gelen tüm aktif GradeRule listesi
 * @param {Array}  dropdowns    - ExtendedFieldDropdown lookup listesi
 * @returns {Promise<{gradeRuleId: number, gradeRuleName: string, reasoning: string}>}
 */
async function selectGradeRule(styleData, gradeRules, dropdowns) {
  const style = styleData.value[0];

  // Dropdown Id → Name lookup tablosu
  const dropdownMap = {};
  for (const d of dropdowns.value) {
    dropdownMap[d.ExtFldDropDownId] = d.Name.trim();
  }

  // Extended field değerlerini çöz (DropdownValues = Id string → Name)
  const extendedFields = (style.StyleExtendedFieldValues || []).map((ef) => {
    const rawValue = ef.DropDownValues;
    const resolvedValue = rawValue
      ? rawValue.split(',').map(id => dropdownMap[Number(id.trim())] || id).join(', ')
      : null;
    return {
      fieldName: ef.StyleExtendedFields?.Name || ef.ExtFldId,
      value: resolvedValue,
    };
  }).filter(ef => ef.value);

  // Ürün özelliklerini okunabilir hale getir
  const styleProfile = {
    'Ürün Kodu': style.StyleCode,
    'Kategori': style.ProductSubSubCategory?.Name,
    'Cinsiyet': style.Gender?.Name,
    'Kalıp (Fit)': style.UserDefinedField1?.Name,
    'Yaka Tipi': style.UserDefinedField3?.Name,
    'Cep': style.UserDefinedField4?.Name,
    'Kol Uzunluğu': style.UserDefinedField6?.Name,
    'Desen': style.MarketField5?.Name,
    'Kumaş Tipi': style.UserDefinedField7?.Name,
    'Sezon': style.Season?.Name,
    'Malzeme Ana Kategorisi': style.StyleBOM?.[0]?.BOMLine?.[0]?.Description,
    'Malzeme Kompozisyonu': style.StyleBOM?.[0]?.BOMLine?.[0]?.Composition,
  };

  // Extended field değerlerini ekle
  for (const ef of extendedFields) {
    styleProfile[ef.fieldName] = ef.value;
  }

  // Boş değerleri çıkar
  const cleanProfile = Object.fromEntries(
    Object.entries(styleProfile).filter(([, v]) => v != null)
  );

  // GradeRule listesini AI'a özet olarak ver (Id + Name)
  const gradeRuleList = gradeRules.value.map(gr => ({
    Id: gr.Id,
    Name: gr.Name.trim(),
  }));

  const systemPrompt = `Sen bir moda PLM (Ürün Yaşam Döngüsü Yönetimi) uzmanısın.
Görevin: Verilen ürün özelliklerine bakarak, GradeRule (ölçü şablonu) listesinden en uygun olanı seçmek.

SEÇIM KURALLARI:
1. Kalıp (Fit) türü en önemli kriterdir: Standart Fit, Slim Fit, Comfort Fit, vb.
2. Yaka tipi ikinci öncelikli kriterdir: Polo Yaka, Bisiklet Yaka, vb.
3. Kol uzunluğu: Uzun Kol, Kısa Kol, Reglan Kol
4. Kumaş yapısı: Triko/Örme için TRİKO içeren şablonlar
5. Ürün kategorisi: Ana kategori ile eşleşen şablonu tercih et
6. "OrmeDokuma" alanı "Örme" ise Triko şablonlarına öncelik ver

ÇIKTI FORMATI (kesinlikle sadece bu JSON):
{
  "gradeRuleId": <seçilen Id sayısı>,
  "gradeRuleName": "<seçilen Name>",
  "reasoning": "<neden seçildiğini 2-3 cümle ile açıkla>"
}`;

  const userPrompt = `ÜRÜN ÖZELLİKLERİ:
${JSON.stringify(cleanProfile, null, 2)}

GRADE RULE LİSTESİ (${gradeRuleList.length} adet):
${JSON.stringify(gradeRuleList, null, 2)}

Bu ürüne en uygun Grade Rule'u seç ve JSON formatında döndür.`;

  console.log('[AI] OpenAI\'a istek gönderiliyor...');
  console.log('[AI] Ürün profili:', JSON.stringify(cleanProfile, null, 2));

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,        // Deterministik sonuç için düşük temperature
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  const result = JSON.parse(content);

  console.log('[AI] Seçilen GradeRule:');
  console.log('     Id     :', result.gradeRuleId);
  console.log('     Name   :', result.gradeRuleName);
  console.log('     Neden  :', result.reasoning);
  console.log('[AI] Token kullanımı - Prompt:', response.usage.prompt_tokens, '/ Completion:', response.usage.completion_tokens);

  return result;
}

module.exports = { selectGradeRule };

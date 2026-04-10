'use strict';

require('dotenv').config();
const axios = require('axios');
const tokenService = require('../auth');

const TENANT_ID = process.env.TENANT_ID;
const BASE_URL  = `${process.env.ION_API_URL}/${TENANT_ID}/FASHIONPLM/odata2/api/odata2`;
const VIEW_URL  = `${process.env.ION_API_URL}/${TENANT_ID}/FASHIONPLM/view/api/view/layout/data/get`;

async function getHeaders() {
  const authHeader = await tokenService.getAuthorizationHeader();
  return {
    'Authorization': authHeader,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Style bilgilerini getirir.
 * Genişletilmiş alanlar, BOM, sezon, beden aralıkları dahil.
 */
async function getStyleById(styleId) {
  const headers = await getHeaders();

  const extFldFilter = [
    'd8aba9e6-6c45-4428-ae00-546251391f3d',
    'dabb3dd6-07f0-469a-b748-c1596c8efb14',
    '1d63c5c5-602a-44cb-8e52-fe08b87290b2',
  ].map(id => `ExtFldId eq ${id}`).join(' or ');

  const expand = [
    'Season',
    'UserDefinedField1',
    'UserDefinedField3',
    'UserDefinedField4',
    'UserDefinedField5',
    'UserDefinedField6',
    'MarketField5',
    'gender',
    'MarketField3',
    'UserDefinedField2',
    'UserDefinedField7',
    'ProductSubSubCategory',
    `STYLEEXTENDEDFIELDVALUES($select=StyleId,Id,ExtFldId,DropDownValues;$orderby= ExtFldId;$filter=${extFldFilter};$expand=STYLEEXTENDEDFIELDS($select=Name))`,
    'STyleBOM($select=Id;$expand=BOMLINE($filter=IsMainLine eq true))',
    'StyleSizeRAnges($expand= StyleSizes($expand=Size))',
  ].join(', ');

  const url = `${BASE_URL}/STYLE`;
  const params = {
    '$filter': `StyleId eq ${styleId}`,
    '$expand': expand,
    '$select': 'StyleId, StyleCode, categoryID',
  };

  console.log(`[PLM] Style API çağrılıyor... StyleId: ${styleId}`);
  const response = await axios.get(url, { headers, params });
  return response.data;
}

/**
 * Aktif (Status=1) tüm GradeRule'ları getirir.
 */
async function getActiveGradeRules() {
  const headers = await getHeaders();

  const url = `${BASE_URL}/GradeRule`;
  const params = {
    '$select': 'Name, GlProdTypeIdList, Id',
    '$filter': 'Status eq 1',
  };

  console.log('[PLM] GradeRule API çağrılıyor...');
  const response = await axios.get(url, { headers, params });
  return response.data;
}

/**
 * Extended field dropdown değerlerini getirir.
 * (Kumaş tipi, ürün grubu vb. lookup değerleri)
 */
async function getExtendedFieldDropdowns() {
  const headers = await getHeaders();

  const extFldIds = [
    'd8aba9e6-6c45-4428-ae00-546251391f3d',
    'dabb3dd6-07f0-469a-b748-c1596c8efb14',
    '1d63c5c5-602a-44cb-8e52-fe08b87290b2',
  ];

  const url = `${BASE_URL}/extendedfielddropdown`;
  const params = {
    '$filter': extFldIds.map(id => `ExtFldId eq ${id}`).join(' or '),
    '$select': 'ExtFldDropDownId, Name',
  };

  console.log('[PLM] ExtendedFieldDropdown API çağrılıyor...');
  const response = await axios.get(url, { headers, params });
  return response.data;
}

/**
 * Belirli bir GradeRule'un detayını view API üzerinden çeker.
 * POM listesi, beden listesi ve her POM × beden için GradeInc değerleri dahil.
 * (OData $expand=GradeRulePom desteklenmediğinden view API kullanılır.)
 */
async function getGradeRuleDetail(gradeRuleId) {
  const headers = await getHeaders();

  const body = {
    roleId:            '1',
    userId:            124,
    personalizationId: 0,
    entity:            'GradeRule',
    pageType:          'details',
    dataFilter: {
      Conditions: [
        { fieldName: 'Id', operator: '=', value: String(gradeRuleId) },
      ],
    },
    pageInfo: null,
    Schema:   'FSH1',
  };

  console.log(`[PLM] GradeRule detay (view API) çekiliyor... Id: ${gradeRuleId}`);
  const response = await axios.post(VIEW_URL, body, { headers });
  return response.data;
}

/**
 * StyleMeasurement payload'unu PLM'e kaydeder.
 * Endpoint: POST /FASHIONPLM/pdm/api/pdm/style/measurement/save
 */
async function saveStyleMeasurement(payload) {
  const headers = await getHeaders();

  const url = `${process.env.ION_API_URL}/${TENANT_ID}/FASHIONPLM/pdm/api/pdm/style/measurement/save`;

  console.log(`[PLM] StyleMeasurement kaydediliyor... StyleId: ${payload.StyleId}`);
  const response = await axios.post(url, payload, { headers });
  return response.data;
}

module.exports = { getStyleById, getActiveGradeRules, getExtendedFieldDropdowns, getGradeRuleDetail, saveStyleMeasurement };

export const FILTER_TABS = [
  { id: 'descriptive', label: 'Descriptive' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'technical', label: 'Technical' },
  { id: 'news', label: 'News' },
  { id: 'all', label: 'All' },
];

export const CATALYST_OPTIONS = [
  'earnings', 'guidance', 'upgrade', 'contract',
  'fda', 'product', 'merger', 'offering', 'general',
];

export const FILTER_DEFINITIONS = {
  descriptive: [
    {
      key: 'sh_price', label: 'Price', type: 'select', finvizCode: 'sh_price',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_price_u1', label: 'Under $1' },
        { value: 'sh_price_u2', label: 'Under $2' },
        { value: 'sh_price_u5', label: 'Under $5' },
        { value: 'sh_price_u10', label: 'Under $10' },
        { value: 'sh_price_u20', label: 'Under $20' },
        { value: 'sh_price_u50', label: 'Under $50' },
        { value: 'sh_price_o1', label: 'Over $1' },
        { value: 'sh_price_o5', label: 'Over $5' },
        { value: 'sh_price_o10', label: 'Over $10' },
        { value: 'sh_price_o20', label: 'Over $20' },
        { value: 'sh_price_o50', label: 'Over $50' },
        { value: 'sh_price_o100', label: 'Over $100' },
        { value: 'sh_price_o200', label: 'Over $200' },
      ],
    },
    {
      key: 'cap', label: 'Market Cap.', type: 'multiselect', finvizCode: 'cap',
      options: [
        { value: 'cap_mega', label: 'Mega ($200B+)' },
        { value: 'cap_large', label: 'Large ($10B-$200B)' },
        { value: 'cap_mid', label: 'Mid ($2B-$10B)' },
        { value: 'cap_small', label: 'Small ($300M-$2B)' },
        { value: 'cap_micro', label: 'Micro ($50M-$300M)' },
        { value: 'cap_nano', label: 'Nano (under $50M)' },
      ],
    },
    {
      key: 'exch', label: 'Exchange', type: 'select', finvizCode: 'exch',
      options: [
        { value: '', label: 'Any' },
        { value: 'exch_nyse', label: 'NYSE' },
        { value: 'exch_nasd', label: 'NASDAQ' },
        { value: 'exch_amex', label: 'AMEX' },
      ],
    },
    {
      key: 'idx', label: 'Index', type: 'select', finvizCode: 'idx',
      options: [
        { value: '', label: 'Any' },
        { value: 'idx_sp500', label: 'S&P 500' },
        { value: 'idx_dji', label: 'DJIA' },
      ],
    },
    {
      key: 'sec', label: 'Sector', type: 'multiselect', finvizCode: 'sec',
      options: [
        { value: 'sec_technology', label: 'Technology' },
        { value: 'sec_healthcare', label: 'Healthcare' },
        { value: 'sec_financials', label: 'Financial' },
        { value: 'sec_energy', label: 'Energy' },
        { value: 'sec_consumerdefensive', label: 'Consumer Defensive' },
        { value: 'sec_consumercyclical', label: 'Consumer Cyclical' },
        { value: 'sec_industrials', label: 'Industrials' },
        { value: 'sec_basicmaterials', label: 'Basic Materials' },
        { value: 'sec_communicationservices', label: 'Communication Services' },
        { value: 'sec_realestate', label: 'Real Estate' },
        { value: 'sec_utilities', label: 'Utilities' },
      ],
    },
    {
      key: 'ind', label: 'Industry', type: 'multiselect', finvizCode: 'ind',
      options: [
        { value: 'ind_semiconductors', label: 'Semiconductors' },
        { value: 'ind_softwareinfrastructure', label: 'Software - Infrastructure' },
        { value: 'ind_softwareapplication', label: 'Software - Application' },
        { value: 'ind_biotechnology', label: 'Biotechnology' },
        { value: 'ind_drugmanufacturers', label: 'Drug Manufacturers' },
        { value: 'ind_banks', label: 'Banks' },
        { value: 'ind_oilgasexploration', label: 'Oil & Gas E&P' },
        { value: 'ind_aerodefense', label: 'Aerospace & Defense' },
        { value: 'ind_autoparts', label: 'Auto Parts' },
        { value: 'ind_internetcontent', label: 'Internet Content & Information' },
      ],
    },
    {
      key: 'geo', label: 'Country', type: 'multiselect', finvizCode: 'geo',
      options: [
        { value: 'geo_usa', label: 'USA' },
        { value: 'geo_china', label: 'China' },
        { value: 'geo_uk', label: 'United Kingdom' },
        { value: 'geo_canada', label: 'Canada' },
        { value: 'geo_japan', label: 'Japan' },
        { value: 'geo_germany', label: 'Germany' },
        { value: 'geo_israel', label: 'Israel' },
      ],
    },
    {
      key: 'fa_div', label: 'Dividend Yield', type: 'select', finvizCode: 'fa_div',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_div_none', label: 'None (0%)' },
        { value: 'fa_div_pos', label: 'Positive (>0%)' },
        { value: 'fa_div_o1', label: 'Over 1%' },
        { value: 'fa_div_o2', label: 'Over 2%' },
        { value: 'fa_div_o3', label: 'Over 3%' },
        { value: 'fa_div_o5', label: 'Over 5%' },
        { value: 'fa_div_o10', label: 'Over 10%' },
      ],
    },
    {
      key: 'sh_float', label: 'Short Float', type: 'select', finvizCode: 'sh_float',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_short_u5', label: 'Under 5%' },
        { value: 'sh_short_u10', label: 'Under 10%' },
        { value: 'sh_short_o5', label: 'Over 5%' },
        { value: 'sh_short_o10', label: 'Over 10%' },
        { value: 'sh_short_o15', label: 'Over 15%' },
        { value: 'sh_short_o20', label: 'Over 20%' },
        { value: 'sh_short_o25', label: 'Over 25%' },
        { value: 'sh_short_o30', label: 'Over 30%' },
      ],
    },
    {
      key: 'sh_avgvol', label: 'Average Volume', type: 'select', finvizCode: 'sh_avgvol',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_avgvol_u50', label: 'Under 50K' },
        { value: 'sh_avgvol_u100', label: 'Under 100K' },
        { value: 'sh_avgvol_u500', label: 'Under 500K' },
        { value: 'sh_avgvol_o100', label: 'Over 100K' },
        { value: 'sh_avgvol_o200', label: 'Over 200K' },
        { value: 'sh_avgvol_o300', label: 'Over 300K' },
        { value: 'sh_avgvol_o500', label: 'Over 500K' },
        { value: 'sh_avgvol_o1000', label: 'Over 1M' },
        { value: 'sh_avgvol_o2000', label: 'Over 2M' },
      ],
    },
    {
      key: 'sh_curvol', label: 'Current Volume', type: 'select', finvizCode: 'sh_curvol',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_curvol_o100', label: 'Over 100K' },
        { value: 'sh_curvol_o300', label: 'Over 300K' },
        { value: 'sh_curvol_o500', label: 'Over 500K' },
        { value: 'sh_curvol_o1000', label: 'Over 1M' },
        { value: 'sh_curvol_o2000', label: 'Over 2M' },
        { value: 'sh_curvol_o5000', label: 'Over 5M' },
        { value: 'sh_curvol_o10000', label: 'Over 10M' },
        { value: 'sh_curvol_o20000', label: 'Over 20M' },
      ],
    },
    {
      key: 'sh_relvol', label: 'Relative Volume', type: 'select', finvizCode: 'sh_relvol',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_relvol_o1', label: 'Over 1' },
        { value: 'sh_relvol_o1.5', label: 'Over 1.5' },
        { value: 'sh_relvol_o2', label: 'Over 2' },
        { value: 'sh_relvol_o3', label: 'Over 3' },
        { value: 'sh_relvol_o5', label: 'Over 5' },
        { value: 'sh_relvol_o10', label: 'Over 10' },
        { value: 'sh_relvol_u0.5', label: 'Under 0.5' },
        { value: 'sh_relvol_u1', label: 'Under 1' },
        { value: 'sh_relvol_u1.5', label: 'Under 1.5' },
      ],
    },
    {
      key: 'ta_trades', label: 'Trades', type: 'select', finvizCode: 'sh_instown',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_instown_o10', label: 'Inst. Own. Over 10%' },
        { value: 'sh_instown_o30', label: 'Inst. Own. Over 30%' },
        { value: 'sh_instown_o50', label: 'Inst. Own. Over 50%' },
        { value: 'sh_instown_o60', label: 'Inst. Own. Over 60%' },
        { value: 'sh_instown_o70', label: 'Inst. Own. Over 70%' },
        { value: 'sh_instown_o80', label: 'Inst. Own. Over 80%' },
        { value: 'sh_instown_o90', label: 'Inst. Own. Over 90%' },
      ],
    },
    {
      key: 'sh_outstanding', label: 'Shares Outstanding', type: 'select', finvizCode: 'sh_outstanding',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_outstanding_u1', label: 'Under 1M' },
        { value: 'sh_outstanding_u5', label: 'Under 5M' },
        { value: 'sh_outstanding_u10', label: 'Under 10M' },
        { value: 'sh_outstanding_u50', label: 'Under 50M' },
        { value: 'sh_outstanding_u100', label: 'Under 100M' },
        { value: 'sh_outstanding_o1', label: 'Over 1M' },
        { value: 'sh_outstanding_o10', label: 'Over 10M' },
        { value: 'sh_outstanding_o50', label: 'Over 50M' },
        { value: 'sh_outstanding_o100', label: 'Over 100M' },
      ],
    },
    {
      key: 'sh_floatshort', label: 'Float', type: 'select', finvizCode: 'sh_floatshort',
      options: [
        { value: '', label: 'Any' },
        { value: 'sh_float_u1', label: 'Under 1M' },
        { value: 'sh_float_u5', label: 'Under 5M' },
        { value: 'sh_float_u10', label: 'Under 10M' },
        { value: 'sh_float_u20', label: 'Under 20M' },
        { value: 'sh_float_u50', label: 'Under 50M' },
        { value: 'sh_float_u100', label: 'Under 100M' },
        { value: 'sh_float_o1', label: 'Over 1M' },
        { value: 'sh_float_o10', label: 'Over 10M' },
        { value: 'sh_float_o50', label: 'Over 50M' },
        { value: 'sh_float_o100', label: 'Over 100M' },
      ],
    },
    {
      key: 'ipodate', label: 'IPO Date', type: 'select', finvizCode: 'ipodate',
      options: [
        { value: '', label: 'Any' },
        { value: 'ipodate_today', label: 'Today' },
        { value: 'ipodate_yesterday', label: 'Yesterday' },
        { value: 'ipodate_prevweek', label: 'Previous Week' },
        { value: 'ipodate_prevmonth', label: 'Previous Month' },
        { value: 'ipodate_prev3', label: 'Within 3 Months' },
        { value: 'ipodate_prev6', label: 'Within 6 Months' },
        { value: 'ipodate_prevyear', label: 'Within 1 Year' },
      ],
    },
  ],

  fundamentals: [
    {
      key: 'fa_pe', label: 'P/E', type: 'select', finvizCode: 'fa_pe',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_pe_u5', label: 'Under 5' },
        { value: 'fa_pe_u10', label: 'Under 10' },
        { value: 'fa_pe_u15', label: 'Under 15' },
        { value: 'fa_pe_u20', label: 'Under 20' },
        { value: 'fa_pe_u25', label: 'Under 25' },
        { value: 'fa_pe_u30', label: 'Under 30' },
        { value: 'fa_pe_u50', label: 'Under 50' },
        { value: 'fa_pe_o5', label: 'Over 5' },
        { value: 'fa_pe_o10', label: 'Over 10' },
        { value: 'fa_pe_o20', label: 'Over 20' },
        { value: 'fa_pe_o50', label: 'Over 50' },
        { value: 'fa_pe_profitable', label: 'Profitable (>0)' },
      ],
    },
    {
      key: 'fa_fpe', label: 'Forward P/E', type: 'select', finvizCode: 'fa_fpe',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_fpe_u5', label: 'Under 5' },
        { value: 'fa_fpe_u10', label: 'Under 10' },
        { value: 'fa_fpe_u15', label: 'Under 15' },
        { value: 'fa_fpe_u20', label: 'Under 20' },
        { value: 'fa_fpe_u30', label: 'Under 30' },
        { value: 'fa_fpe_u50', label: 'Under 50' },
        { value: 'fa_fpe_o50', label: 'Over 50' },
      ],
    },
    {
      key: 'fa_peg', label: 'PEG', type: 'select', finvizCode: 'fa_peg',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_peg_u1', label: 'Under 1' },
        { value: 'fa_peg_u2', label: 'Under 2' },
        { value: 'fa_peg_u3', label: 'Under 3' },
        { value: 'fa_peg_o1', label: 'Over 1' },
        { value: 'fa_peg_o2', label: 'Over 2' },
        { value: 'fa_peg_o3', label: 'Over 3' },
      ],
    },
    {
      key: 'fa_ps', label: 'P/S', type: 'select', finvizCode: 'fa_ps',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_ps_u1', label: 'Under 1' },
        { value: 'fa_ps_u2', label: 'Under 2' },
        { value: 'fa_ps_u5', label: 'Under 5' },
        { value: 'fa_ps_u10', label: 'Under 10' },
        { value: 'fa_ps_o1', label: 'Over 1' },
        { value: 'fa_ps_o5', label: 'Over 5' },
        { value: 'fa_ps_o10', label: 'Over 10' },
      ],
    },
    {
      key: 'fa_pb', label: 'P/B', type: 'select', finvizCode: 'fa_pb',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_pb_u1', label: 'Under 1' },
        { value: 'fa_pb_u2', label: 'Under 2' },
        { value: 'fa_pb_u3', label: 'Under 3' },
        { value: 'fa_pb_u5', label: 'Under 5' },
        { value: 'fa_pb_o1', label: 'Over 1' },
        { value: 'fa_pb_o5', label: 'Over 5' },
        { value: 'fa_pb_o10', label: 'Over 10' },
      ],
    },
    {
      key: 'fa_pricecash', label: 'Price/Cash', type: 'select', finvizCode: 'fa_pricecash',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_pricecash_u1', label: 'Under 1' },
        { value: 'fa_pricecash_u3', label: 'Under 3' },
        { value: 'fa_pricecash_u5', label: 'Under 5' },
        { value: 'fa_pricecash_o1', label: 'Over 1' },
        { value: 'fa_pricecash_o5', label: 'Over 5' },
        { value: 'fa_pricecash_o10', label: 'Over 10' },
        { value: 'fa_pricecash_o50', label: 'Over 50' },
      ],
    },
    {
      key: 'fa_pfcf', label: 'Price/Free Cash Flow', type: 'select', finvizCode: 'fa_pfcf',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_pfcf_u5', label: 'Under 5' },
        { value: 'fa_pfcf_u10', label: 'Under 10' },
        { value: 'fa_pfcf_u15', label: 'Under 15' },
        { value: 'fa_pfcf_u20', label: 'Under 20' },
        { value: 'fa_pfcf_u50', label: 'Under 50' },
        { value: 'fa_pfcf_u100', label: 'Under 100' },
        { value: 'fa_pfcf_o5', label: 'Over 5' },
        { value: 'fa_pfcf_o10', label: 'Over 10' },
        { value: 'fa_pfcf_o20', label: 'Over 20' },
        { value: 'fa_pfcf_o50', label: 'Over 50' },
        { value: 'fa_pfcf_o100', label: 'Over 100' },
      ],
    },
    {
      key: 'fa_epsyoy', label: 'EPS Growth This Year', type: 'select', finvizCode: 'fa_epsyoy',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_epsyoy_pos', label: 'Positive (>0%)' },
        { value: 'fa_epsyoy_o5', label: 'Over 5%' },
        { value: 'fa_epsyoy_o10', label: 'Over 10%' },
        { value: 'fa_epsyoy_o25', label: 'Over 25%' },
        { value: 'fa_epsyoy_o50', label: 'Over 50%' },
        { value: 'fa_epsyoy_neg', label: 'Negative (<0%)' },
      ],
    },
    {
      key: 'fa_epsyoy1', label: 'EPS Growth Next Year', type: 'select', finvizCode: 'fa_epsyoy1',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_epsyoy1_pos', label: 'Positive (>0%)' },
        { value: 'fa_epsyoy1_o5', label: 'Over 5%' },
        { value: 'fa_epsyoy1_o10', label: 'Over 10%' },
        { value: 'fa_epsyoy1_o25', label: 'Over 25%' },
        { value: 'fa_epsyoy1_o50', label: 'Over 50%' },
        { value: 'fa_epsyoy1_neg', label: 'Negative (<0%)' },
      ],
    },
    {
      key: 'fa_roe', label: 'Return on Equity', type: 'select', finvizCode: 'fa_roe',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_roe_pos', label: 'Positive (>0%)' },
        { value: 'fa_roe_o5', label: 'Over 5%' },
        { value: 'fa_roe_o10', label: 'Over 10%' },
        { value: 'fa_roe_o15', label: 'Over 15%' },
        { value: 'fa_roe_o20', label: 'Over 20%' },
        { value: 'fa_roe_o25', label: 'Over 25%' },
        { value: 'fa_roe_o30', label: 'Over 30%' },
        { value: 'fa_roe_neg', label: 'Negative (<0%)' },
      ],
    },
    {
      key: 'fa_roa', label: 'Return on Assets', type: 'select', finvizCode: 'fa_roa',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_roa_pos', label: 'Positive (>0%)' },
        { value: 'fa_roa_o5', label: 'Over 5%' },
        { value: 'fa_roa_o10', label: 'Over 10%' },
        { value: 'fa_roa_o15', label: 'Over 15%' },
        { value: 'fa_roa_o20', label: 'Over 20%' },
        { value: 'fa_roa_neg', label: 'Negative (<0%)' },
      ],
    },
    {
      key: 'fa_curratio', label: 'Current Ratio', type: 'select', finvizCode: 'fa_curratio',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_curratio_u0.5', label: 'Under 0.5' },
        { value: 'fa_curratio_u1', label: 'Under 1' },
        { value: 'fa_curratio_u1.5', label: 'Under 1.5' },
        { value: 'fa_curratio_u2', label: 'Under 2' },
        { value: 'fa_curratio_o1', label: 'Over 1' },
        { value: 'fa_curratio_o1.5', label: 'Over 1.5' },
        { value: 'fa_curratio_o2', label: 'Over 2' },
        { value: 'fa_curratio_o3', label: 'Over 3' },
        { value: 'fa_curratio_o5', label: 'Over 5' },
      ],
    },
    {
      key: 'fa_debteq', label: 'Debt/Equity', type: 'select', finvizCode: 'fa_debteq',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_debteq_u0.1', label: 'Under 0.1' },
        { value: 'fa_debteq_u0.5', label: 'Under 0.5' },
        { value: 'fa_debteq_u1', label: 'Under 1' },
        { value: 'fa_debteq_o0.5', label: 'Over 0.5' },
        { value: 'fa_debteq_o1', label: 'Over 1' },
        { value: 'fa_debteq_o2', label: 'Over 2' },
      ],
    },
    {
      key: 'fa_ltdebteq', label: 'LT Debt/Equity', type: 'select', finvizCode: 'fa_ltdebteq',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_ltdebteq_u0.1', label: 'Under 0.1' },
        { value: 'fa_ltdebteq_u0.5', label: 'Under 0.5' },
        { value: 'fa_ltdebteq_u1', label: 'Under 1' },
        { value: 'fa_ltdebteq_o0.5', label: 'Over 0.5' },
        { value: 'fa_ltdebteq_o1', label: 'Over 1' },
        { value: 'fa_ltdebteq_o2', label: 'Over 2' },
      ],
    },
    {
      key: 'fa_grossmargin', label: 'Gross Margin', type: 'select', finvizCode: 'fa_grossmargin',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_grossmargin_pos', label: 'Positive (>0%)' },
        { value: 'fa_grossmargin_o10', label: 'Over 10%' },
        { value: 'fa_grossmargin_o20', label: 'Over 20%' },
        { value: 'fa_grossmargin_o30', label: 'Over 30%' },
        { value: 'fa_grossmargin_o40', label: 'Over 40%' },
        { value: 'fa_grossmargin_o50', label: 'Over 50%' },
        { value: 'fa_grossmargin_o70', label: 'Over 70%' },
        { value: 'fa_grossmargin_o90', label: 'Over 90%' },
        { value: 'fa_grossmargin_neg', label: 'Negative (<0%)' },
      ],
    },
    {
      key: 'fa_opermargin', label: 'Operating Margin', type: 'select', finvizCode: 'fa_opermargin',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_opermargin_pos', label: 'Positive (>0%)' },
        { value: 'fa_opermargin_o10', label: 'Over 10%' },
        { value: 'fa_opermargin_o20', label: 'Over 20%' },
        { value: 'fa_opermargin_o30', label: 'Over 30%' },
        { value: 'fa_opermargin_neg', label: 'Negative (<0%)' },
      ],
    },
    {
      key: 'fa_netmargin', label: 'Net Profit Margin', type: 'select', finvizCode: 'fa_netmargin',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_netmargin_pos', label: 'Positive (>0%)' },
        { value: 'fa_netmargin_o5', label: 'Over 5%' },
        { value: 'fa_netmargin_o10', label: 'Over 10%' },
        { value: 'fa_netmargin_o20', label: 'Over 20%' },
        { value: 'fa_netmargin_neg', label: 'Negative (<0%)' },
      ],
    },
    {
      key: 'fa_payoutratio', label: 'Payout Ratio', type: 'select', finvizCode: 'fa_payoutratio',
      options: [
        { value: '', label: 'Any' },
        { value: 'fa_payoutratio_u10', label: 'Under 10%' },
        { value: 'fa_payoutratio_u20', label: 'Under 20%' },
        { value: 'fa_payoutratio_u30', label: 'Under 30%' },
        { value: 'fa_payoutratio_u50', label: 'Under 50%' },
        { value: 'fa_payoutratio_o10', label: 'Over 10%' },
        { value: 'fa_payoutratio_o20', label: 'Over 20%' },
        { value: 'fa_payoutratio_o50', label: 'Over 50%' },
        { value: 'fa_payoutratio_o100', label: 'Over 100%' },
        { value: 'fa_payoutratio_none', label: 'None (0%)' },
      ],
    },
  ],

  technical: [
    {
      key: 'ta_perf', label: 'Performance', type: 'select', finvizCode: 'ta_perf',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_perf_dup', label: 'Today Up' },
        { value: 'ta_perf_ddown', label: 'Today Down' },
        { value: 'ta_perf_1wup', label: 'Week Up' },
        { value: 'ta_perf_1wdown', label: 'Week Down' },
        { value: 'ta_perf_4wup', label: 'Month Up' },
        { value: 'ta_perf_4wdown', label: 'Month Down' },
        { value: 'ta_perf_13wup', label: 'Quarter Up' },
        { value: 'ta_perf_13wdown', label: 'Quarter Down' },
        { value: 'ta_perf_52wup', label: 'Year Up' },
        { value: 'ta_perf_52wdown', label: 'Year Down' },
      ],
    },
    {
      key: 'ta_perf2', label: 'Performance 2', type: 'select', finvizCode: 'ta_perf2',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_perf2_dup', label: 'Today Up' },
        { value: 'ta_perf2_ddown', label: 'Today Down' },
        { value: 'ta_perf2_1wup', label: 'Week Up' },
        { value: 'ta_perf2_1wdown', label: 'Week Down' },
        { value: 'ta_perf2_4wup', label: 'Month Up' },
        { value: 'ta_perf2_4wdown', label: 'Month Down' },
      ],
    },
    {
      key: 'ta_volatility', label: 'Volatility', type: 'select', finvizCode: 'ta_volatility',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_volatility_wo3', label: 'Week - Over 3%' },
        { value: 'ta_volatility_wo5', label: 'Week - Over 5%' },
        { value: 'ta_volatility_wo10', label: 'Week - Over 10%' },
        { value: 'ta_volatility_wo15', label: 'Week - Over 15%' },
        { value: 'ta_volatility_mo3', label: 'Month - Over 3%' },
        { value: 'ta_volatility_mo5', label: 'Month - Over 5%' },
        { value: 'ta_volatility_mo10', label: 'Month - Over 10%' },
        { value: 'ta_volatility_mo15', label: 'Month - Over 15%' },
      ],
    },
    {
      key: 'ta_rsi', label: 'RSI (14)', type: 'select', finvizCode: 'ta_rsi',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_rsi_ob90', label: 'Overbought (>90)' },
        { value: 'ta_rsi_ob80', label: 'Overbought (>80)' },
        { value: 'ta_rsi_ob70', label: 'Overbought (>70)' },
        { value: 'ta_rsi_ob60', label: 'Overbought (>60)' },
        { value: 'ta_rsi_os30', label: 'Oversold (<30)' },
        { value: 'ta_rsi_os20', label: 'Oversold (<20)' },
        { value: 'ta_rsi_os10', label: 'Oversold (<10)' },
        { value: 'ta_rsi_nob60', label: 'Not Overbought (<60)' },
        { value: 'ta_rsi_nos40', label: 'Not Oversold (>40)' },
      ],
    },
    {
      key: 'ta_gap', label: 'Gap', type: 'select', finvizCode: 'ta_gap',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_gap_u', label: 'Up' },
        { value: 'ta_gap_u1', label: 'Up 1%+' },
        { value: 'ta_gap_u2', label: 'Up 2%+' },
        { value: 'ta_gap_u3', label: 'Up 3%+' },
        { value: 'ta_gap_u4', label: 'Up 4%+' },
        { value: 'ta_gap_u5', label: 'Up 5%+' },
        { value: 'ta_gap_d', label: 'Down' },
        { value: 'ta_gap_d1', label: 'Down 1%+' },
        { value: 'ta_gap_d2', label: 'Down 2%+' },
        { value: 'ta_gap_d3', label: 'Down 3%+' },
        { value: 'ta_gap_d4', label: 'Down 4%+' },
        { value: 'ta_gap_d5', label: 'Down 5%+' },
      ],
    },
    {
      key: 'ta_change', label: 'Change', type: 'select', finvizCode: 'ta_change',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_change_u', label: 'Up' },
        { value: 'ta_change_u1', label: 'Up 1%+' },
        { value: 'ta_change_u2', label: 'Up 2%+' },
        { value: 'ta_change_u3', label: 'Up 3%+' },
        { value: 'ta_change_u5', label: 'Up 5%+' },
        { value: 'ta_change_u10', label: 'Up 10%+' },
        { value: 'ta_change_u15', label: 'Up 15%+' },
        { value: 'ta_change_u20', label: 'Up 20%+' },
        { value: 'ta_change_d', label: 'Down' },
        { value: 'ta_change_d1', label: 'Down 1%+' },
        { value: 'ta_change_d2', label: 'Down 2%+' },
        { value: 'ta_change_d3', label: 'Down 3%+' },
        { value: 'ta_change_d5', label: 'Down 5%+' },
        { value: 'ta_change_d10', label: 'Down 10%+' },
      ],
    },
    {
      key: 'ta_changeopen', label: 'Change from Open', type: 'select', finvizCode: 'ta_changeopen',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_changeopen_u', label: 'Up' },
        { value: 'ta_changeopen_u1', label: 'Up 1%+' },
        { value: 'ta_changeopen_u2', label: 'Up 2%+' },
        { value: 'ta_changeopen_u3', label: 'Up 3%+' },
        { value: 'ta_changeopen_u5', label: 'Up 5%+' },
        { value: 'ta_changeopen_d', label: 'Down' },
        { value: 'ta_changeopen_d1', label: 'Down 1%+' },
        { value: 'ta_changeopen_d2', label: 'Down 2%+' },
        { value: 'ta_changeopen_d3', label: 'Down 3%+' },
        { value: 'ta_changeopen_d5', label: 'Down 5%+' },
      ],
    },
    {
      key: 'ta_sma20', label: '20-Day SMA', type: 'select', finvizCode: 'ta_sma20',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_sma20_pa', label: 'Price Above' },
        { value: 'ta_sma20_pb', label: 'Price Below' },
        { value: 'ta_sma20_cross', label: 'Price Crossed Above' },
        { value: 'ta_sma20_crossb', label: 'Price Crossed Below' },
        { value: 'ta_sma20_pa10', label: '10% Above' },
        { value: 'ta_sma20_pb10', label: '10% Below' },
      ],
    },
    {
      key: 'ta_sma50', label: '50-Day SMA', type: 'select', finvizCode: 'ta_sma50',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_sma50_pa', label: 'Price Above' },
        { value: 'ta_sma50_pb', label: 'Price Below' },
        { value: 'ta_sma50_cross', label: 'Price Crossed Above' },
        { value: 'ta_sma50_crossb', label: 'Price Crossed Below' },
        { value: 'ta_sma50_pa10', label: '10% Above' },
        { value: 'ta_sma50_pb10', label: '10% Below' },
      ],
    },
    {
      key: 'ta_sma200', label: '200-Day SMA', type: 'select', finvizCode: 'ta_sma200',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_sma200_pa', label: 'Price Above' },
        { value: 'ta_sma200_pb', label: 'Price Below' },
        { value: 'ta_sma200_cross', label: 'Price Crossed Above' },
        { value: 'ta_sma200_crossb', label: 'Price Crossed Below' },
      ],
    },
    {
      key: 'ta_highlow50d', label: '50-Day High/Low', type: 'select', finvizCode: 'ta_highlow50d',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_highlow50d_nh', label: 'New High' },
        { value: 'ta_highlow50d_nl', label: 'New Low' },
        { value: 'ta_highlow50d_h0to3', label: '0-3% Below High' },
        { value: 'ta_highlow50d_h0to5', label: '0-5% Below High' },
        { value: 'ta_highlow50d_h0to10', label: '0-10% Below High' },
      ],
    },
    {
      key: 'ta_highlow52w', label: '52-Week High/Low', type: 'select', finvizCode: 'ta_highlow52w',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_highlow52w_nh', label: 'New High' },
        { value: 'ta_highlow52w_nl', label: 'New Low' },
        { value: 'ta_highlow52w_h0to3', label: '0-3% Below High' },
        { value: 'ta_highlow52w_h0to5', label: '0-5% Below High' },
        { value: 'ta_highlow52w_h0to10', label: '0-10% Below High' },
        { value: 'ta_highlow52w_h50', label: '50%+ Below High' },
      ],
    },
    {
      key: 'ta_pattern', label: 'Pattern', type: 'select', finvizCode: 'ta_pattern',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_pattern_hs', label: 'Head & Shoulders' },
        { value: 'ta_pattern_ihs', label: 'Inverse Head & Shoulders' },
        { value: 'ta_pattern_doubletop', label: 'Double Top' },
        { value: 'ta_pattern_doublebottom', label: 'Double Bottom' },
        { value: 'ta_pattern_wedgeup', label: 'Wedge Up' },
        { value: 'ta_pattern_wedgedown', label: 'Wedge Down' },
        { value: 'ta_pattern_channelup', label: 'Channel Up' },
        { value: 'ta_pattern_channeldown', label: 'Channel Down' },
        { value: 'ta_pattern_tlresistance', label: 'TL Resistance' },
        { value: 'ta_pattern_tlsupport', label: 'TL Support' },
      ],
    },
    {
      key: 'ta_candlestick', label: 'Candlestick', type: 'select', finvizCode: 'ta_candlestick',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_candlestick_longlowershad', label: 'Long Lower Shadow' },
        { value: 'ta_candlestick_longuppershad', label: 'Long Upper Shadow' },
        { value: 'ta_candlestick_hammer', label: 'Hammer' },
        { value: 'ta_candlestick_invertedhammer', label: 'Inverted Hammer' },
        { value: 'ta_candlestick_spinningtop', label: 'Spinning Top' },
        { value: 'ta_candlestick_doji', label: 'Doji' },
        { value: 'ta_candlestick_engulfing', label: 'Engulfing' },
        { value: 'ta_candlestick_marubozu', label: 'Marubozu' },
      ],
    },
    {
      key: 'ta_beta', label: 'Beta', type: 'select', finvizCode: 'ta_beta',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_beta_u0.5', label: 'Under 0.5' },
        { value: 'ta_beta_u1', label: 'Under 1' },
        { value: 'ta_beta_u1.5', label: 'Under 1.5' },
        { value: 'ta_beta_u2', label: 'Under 2' },
        { value: 'ta_beta_o1', label: 'Over 1' },
        { value: 'ta_beta_o1.5', label: 'Over 1.5' },
        { value: 'ta_beta_o2', label: 'Over 2' },
        { value: 'ta_beta_o3', label: 'Over 3' },
        { value: 'ta_beta_o4', label: 'Over 4' },
      ],
    },
    {
      key: 'ta_averagetruerange', label: 'Average True Range', type: 'select', finvizCode: 'ta_averagetruerange',
      options: [
        { value: '', label: 'Any' },
        { value: 'ta_averagetruerange_u0.25', label: 'Under 0.25' },
        { value: 'ta_averagetruerange_u0.5', label: 'Under 0.5' },
        { value: 'ta_averagetruerange_u0.75', label: 'Under 0.75' },
        { value: 'ta_averagetruerange_u1', label: 'Under 1' },
        { value: 'ta_averagetruerange_u1.5', label: 'Under 1.5' },
        { value: 'ta_averagetruerange_u2', label: 'Under 2' },
        { value: 'ta_averagetruerange_o0.25', label: 'Over 0.25' },
        { value: 'ta_averagetruerange_o0.5', label: 'Over 0.5' },
        { value: 'ta_averagetruerange_o0.75', label: 'Over 0.75' },
        { value: 'ta_averagetruerange_o1', label: 'Over 1' },
        { value: 'ta_averagetruerange_o1.5', label: 'Over 1.5' },
        { value: 'ta_averagetruerange_o2', label: 'Over 2' },
        { value: 'ta_averagetruerange_o3', label: 'Over 3' },
        { value: 'ta_averagetruerange_o5', label: 'Over 5' },
      ],
    },
  ],

  news: [
    { key: 'tickersInput', label: 'Tickers', type: 'text', clientSide: true, placeholder: 'e.g. NVDA, TSLA' },
    {
      key: 'newsFreshness', label: 'News Freshness', type: 'select', clientSide: true,
      options: [
        { value: 'any', label: 'Any time' },
        { value: '15m', label: '< 15 min' },
        { value: '1h', label: '< 1 hour' },
        { value: '2h', label: '< 2 hours' },
        { value: '6h', label: '< 6 hours' },
        { value: '12h', label: '< 12 hours' },
        { value: '24h', label: '< 24 hours' },
        { value: '48h', label: '< 2 days' },
        { value: 'week', label: 'This week' },
        { value: 'month', label: 'This month' },
      ],
    },
    { key: 'catalysts', label: 'Catalysts', type: 'pills', clientSide: true },
    { key: 'scoreMin', label: 'Score Min', type: 'text', clientSide: true },
    { key: 'scoreMax', label: 'Score Max', type: 'text', clientSide: true },
  ],
};

/** Strategy preset filters */
export const STRATEGY_PRESETS = [
  {
    name: 'ORB Intraday',
    description: 'Gappers with Avg Vol > 500K, Change > 3%',
    filters: {
      sh_avgvol: 'sh_avgvol_o500',
      ta_change: 'ta_change_u3',
    },
  },
  {
    name: 'Earnings Momentum',
    description: 'Earnings within next 5 days, liquid stocks',
    filters: {
      sh_avgvol: 'sh_avgvol_o200',
      cap: ['cap_mega', 'cap_large', 'cap_mid', 'cap_small'],
    },
  },
  {
    name: 'Continuation',
    description: 'Above 20-SMA & 50-SMA, Avg Vol > 500K',
    filters: {
      ta_sma20: 'ta_sma20_pa',
      ta_sma50: 'ta_sma50_pa',
      sh_avgvol: 'sh_avgvol_o500',
    },
  },
  {
    name: 'High Short Squeeze',
    description: 'Short Float > 20%, Relative Volume > 1.5',
    filters: {
      sh_float: 'sh_short_o20',
      sh_relvol: 'sh_relvol_o1.5',
      sh_avgvol: 'sh_avgvol_o200',
    },
  },
  {
    name: 'Small Cap Momentum',
    description: 'Micro/Small Cap, Up 5%+, Avg Vol > 200K',
    filters: {
      cap: ['cap_small', 'cap_micro'],
      ta_change: 'ta_change_u5',
      sh_avgvol: 'sh_avgvol_o200',
    },
  },
  {
    name: 'Value Picks',
    description: 'P/E < 15, ROE > 15%, Dividend > 2%',
    filters: {
      fa_pe: 'fa_pe_u15',
      fa_roe: 'fa_roe_o15',
      fa_div: 'fa_div_o2',
    },
  },
];

/** Collect non-empty Finviz f= codes from current filter state */
export function buildFinvizFilterString(filterState) {
  const codes = [];
  for (const defs of Object.values(FILTER_DEFINITIONS)) {
    for (const def of defs) {
      if (def.clientSide || def.type === 'pills') continue;
      const val = filterState[def.key];
      if (def.type === 'multiselect') {
        if (Array.isArray(val) && val.length > 0) {
          // Finviz supports comma-separated values for multi-select filters
          codes.push(...val);
        }
      } else if (val && typeof val === 'string' && val.length > 0) {
        codes.push(val);
      }
    }
  }
  return codes.join(',');
}

/** Build default filter state from definitions */
export function buildFilterDefaults() {
  const defaults = {};
  for (const defs of Object.values(FILTER_DEFINITIONS)) {
    for (const def of defs) {
      if (def.type === 'pills' || def.type === 'multiselect') {
        defaults[def.key] = [];
      } else {
        defaults[def.key] = '';
      }
    }
  }
  return defaults;
}

SELECT
  ee.symbol,
  COALESCE(ee.earnings_date, ee.report_date) AS earnings_date,
  ee.eps_estimate,
  ee.eps_actual,
  ROUND(
    (EXTRACT(EPOCH FROM ((COALESCE(ee.earnings_date, ee.report_date)::timestamp with time zone) - NOW())) / 86400.0)::numeric,
    2
  ) AS days_to_earnings
FROM earnings_events ee
WHERE COALESCE(ee.earnings_date, ee.report_date) IS NOT NULL
  AND COALESCE(ee.earnings_date, ee.report_date) >= CURRENT_DATE
ORDER BY COALESCE(ee.earnings_date, ee.report_date) ASC, ee.symbol ASC
LIMIT 50;
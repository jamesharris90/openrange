CREATE TABLE IF NOT EXISTS signal_performance (

	id SERIAL PRIMARY KEY,

	signal_id INTEGER,

	symbol TEXT,

	strategy TEXT,

	class TEXT,

	score INTEGER,

	probability NUMERIC,

	entry_price NUMERIC,

	max_upside NUMERIC,
	max_drawdown NUMERIC,

	outcome TEXT,

	created_at TIMESTAMP DEFAULT NOW(),
	evaluated_at TIMESTAMP

);


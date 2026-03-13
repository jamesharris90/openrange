const cors = require('cors');

const allowedOrigins = [
  'https://openrangetrading.co.uk',
  'https://www.openrangetrading.co.uk',
  'http://localhost:5173',
  'http://localhost:3000',
];

function applyCors(app) {
  app.use(cors({
    origin: function (origin, callback) {
      // Allow server-to-server and same-origin requests (no Origin header)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS policy blocked request from ' + origin), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'x-api-key'],
    credentials: true,
    optionsSuccessStatus: 200,
  }));

  // Ensure preflight OPTIONS requests are handled before auth middleware
  app.options('*', cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS policy blocked request from ' + origin), false);
    },
    credentials: true,
    optionsSuccessStatus: 200,
  }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key');
    next();
  });
}

module.exports = {
  applyCors,
};

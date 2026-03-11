const cors = require('cors');

function applyCors(app) {
  app.use(cors({
    origin: [
      'https://openrangetrading.co.uk',
      'http://localhost:5173',
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  }));
}

module.exports = {
  applyCors,
};

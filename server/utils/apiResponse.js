const ok = (data) => ({ ok: true, data, error: null });
const fail = (error) => ({ ok: false, data: null, error });

module.exports = {
  ok,
  fail,
};

const clients = [];

function addClient(res) {
  clients.push(res);
}

function removeClient(res) {
  const index = clients.indexOf(res);
  if (index !== -1) clients.splice(index, 1);
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach((client) => {
    try {
      client.write(payload);
    } catch (_) {
      removeClient(client);
    }
  });
}

module.exports = {
  addClient,
  removeClient,
  broadcast,
};

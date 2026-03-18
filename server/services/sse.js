const sseClients = new Set();

function broadcastSSE(event, data) {
  const named = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  const generic = 'event: webhook\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const client of sseClients) {
    try { client.write(named); client.write(generic); } catch { sseClients.delete(client); }
  }
}

function addClient(res) { sseClients.add(res); }
function removeClient(res) { sseClients.delete(res); }
function clientCount() { return sseClients.size; }

module.exports = { broadcastSSE, addClient, removeClient, clientCount };

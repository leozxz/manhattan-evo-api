const redis = require('./redis');

const sseClients = new Set();

function sendToClients(event, data) {
  const named = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  const generic = 'event: webhook\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const client of sseClients) {
    try { client.write(named); client.write(generic); } catch { sseClients.delete(client); }
  }
}

function broadcastSSE(event, data) {
  // Send to local clients
  sendToClients(event, data);
  // Publish to Redis for other servers
  redis.publishSSE(event, data);
}

function addClient(res) { sseClients.add(res); }
function removeClient(res) { sseClients.delete(res); }
function clientCount() { return sseClients.size; }

// Subscribe to Redis pub/sub for events from other servers
function initPubSub() {
  redis.subscribeSSE((event, data) => {
    // Only send to local clients (avoid re-publishing)
    sendToClients(event, data);
  });
}

module.exports = { broadcastSSE, addClient, removeClient, clientCount, initPubSub };

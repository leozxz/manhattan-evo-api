const http = require("http");
const readline = require("readline");

const BASE_URL = process.env.EVO_API_URL || "http://localhost:8080";
const API_KEY = process.env.EVO_API_KEY || "";
const INSTANCE_NAME = process.env.INSTANCE_NAME || "minha-instancia";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
      },
    };

    if (data) {
      options.headers["Content-Length"] = Buffer.byteLength(data);
    }

    const req = http.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function step1_createInstance() {
  console.log("\n=== PASSO 1: Criar Instancia ===\n");

  const res = await request("POST", "/instance/create", {
    instanceName: INSTANCE_NAME,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    rejectCall: false,
    groupsIgnore: false,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
  });

  if (res.status === 201 || res.status === 200) {
    console.log("Instancia criada com sucesso!");
    console.log("Status:", res.data?.instance?.status);

    if (res.data?.qrcode?.base64) {
      console.log("\n--- QR CODE ---");
      console.log("O QR Code foi gerado. Abra o link abaixo no navegador para visualizar:");
      console.log(`${BASE_URL}/manager`);
      console.log("\nOu acesse: ${BASE_URL}/instance/connect/${INSTANCE_NAME}");
      console.log("\nEscaneie o QR Code com seu WhatsApp:");
      console.log("  WhatsApp -> Menu (3 pontos) -> Dispositivos conectados -> Conectar dispositivo");
    }
    return true;
  } else {
    console.log("Erro ao criar instancia:", JSON.stringify(res.data, null, 2));
    return false;
  }
}

async function checkConnection() {
  const res = await request("GET", `/instance/connectionState/${INSTANCE_NAME}`);
  return res.data?.instance?.state;
}

async function step2_waitConnection() {
  console.log("\n=== PASSO 2: Aguardando conexao do WhatsApp ===\n");
  console.log("Escaneie o QR Code no seu celular...");
  console.log("Verificando conexao a cada 5 segundos...\n");

  for (let i = 0; i < 60; i++) {
    const state = await checkConnection();
    process.stdout.write(`  Tentativa ${i + 1}/60 - Estado: ${state}\r`);

    if (state === "open") {
      console.log("\n\n  CONECTADO! WhatsApp vinculado com sucesso!\n");
      return true;
    }
    await sleep(5000);
  }

  console.log("\n\nTimeout: QR Code expirou. Execute o script novamente.");
  return false;
}

async function step3_createGroup(participantNumber) {
  console.log("\n=== PASSO 3: Criar Grupo ===\n");

  const res = await request("POST", `/group/create/${INSTANCE_NAME}`, {
    subject: "Grupo Evolution API",
    description: "Grupo criado via Evolution API",
    participants: [participantNumber],
  });

  if (res.status === 200 || res.status === 201) {
    const groupId = res.data?.id || res.data?.groupJid || res.data?.jid;
    console.log("Grupo criado com sucesso!");
    console.log("Group ID:", groupId);
    return groupId;
  } else {
    console.log("Erro ao criar grupo:", JSON.stringify(res.data, null, 2));
    return null;
  }
}

async function step4_sendMessage(groupId) {
  console.log("\n=== PASSO 4: Enviar mensagem 'Oi' ===\n");

  await sleep(2000);

  const res = await request("POST", `/message/sendText/${INSTANCE_NAME}`, {
    number: groupId,
    text: "Oi",
  });

  if (res.status === 200 || res.status === 201) {
    console.log("Mensagem 'Oi' enviada com sucesso!");
    console.log("Detalhes:", JSON.stringify(res.data, null, 2));
    return true;
  } else {
    console.log("Erro ao enviar mensagem:", JSON.stringify(res.data, null, 2));
    return false;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Evolution API - WhatsApp Automation    ║");
  console.log("╚══════════════════════════════════════════╝");

  const numero = await ask(
    "\nDigite o numero para adicionar ao grupo (com DDI+DDD, ex: 5511999999999): "
  );

  if (!numero || numero.length < 10) {
    console.log("Numero invalido. Use o formato: 5511999999999");
    rl.close();
    return;
  }

  // Passo 1: Criar instancia
  const instanceCreated = await step1_createInstance();
  if (!instanceCreated) {
    rl.close();
    return;
  }

  // Passo 2: Aguardar conexao
  await ask("\nPressione ENTER quando tiver escaneado o QR Code...");

  const connected = await step2_waitConnection();
  if (!connected) {
    rl.close();
    return;
  }

  // Passo 3: Criar grupo
  const groupId = await step3_createGroup(numero);
  if (!groupId) {
    rl.close();
    return;
  }

  // Passo 4: Enviar "Oi"
  await step4_sendMessage(groupId);

  console.log("\n=== CONCLUIDO! ===");
  console.log("Grupo criado e mensagem enviada com sucesso!\n");

  rl.close();
}

main().catch((err) => {
  console.error("Erro:", err.message);
  rl.close();
});

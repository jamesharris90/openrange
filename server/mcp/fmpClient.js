const FMP_MCP_URL =
  'https://financialmodelingprep.com/mcp?apikey=' + (process.env.FMP_API_KEY || '');

async function getMcpClient() {
  try {
    if (!process.env.FMP_API_KEY) {
      console.warn('[MCP] FMP_API_KEY missing, skipping MCP context');
      return null;
    }

    let Client;
    let StreamableHTTPClientTransport;

    try {
      ({ Client } = require('@modelcontextprotocol/client'));
      StreamableHTTPClientTransport = null;
    } catch (_err) {
      ({ Client } = require('@modelcontextprotocol/sdk/client'));
      ({ StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp'));
    }

    // Support either the prompt's lightweight client constructor or the official SDK transport pattern.
    if (!StreamableHTTPClientTransport) {
      const directClient = new Client(FMP_MCP_URL);
      await directClient.connect();
      return directClient;
    }

    const sdkClient = new Client({
      name: 'openrange-mcp-client',
      version: '1.0.0',
    });
    const transport = new StreamableHTTPClientTransport(new URL(FMP_MCP_URL));
    await sdkClient.connect(transport);

    return {
      async call_tool(name, args) {
        const result = await sdkClient.request(
          {
            method: 'tools/call',
            params: {
              name,
              arguments: args || {},
            },
          }
        );
        return result;
      },
      async close() {
        if (transport && typeof transport.close === 'function') {
          await transport.close();
        }
      },
    };
  } catch (err) {
    console.warn('[MCP] connection failed, continuing without MCP context', err.message);
    return null;
  }
}

module.exports = { getMcpClient };
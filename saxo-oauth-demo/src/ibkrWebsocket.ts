import EventEmitter from 'events';
import WebSocket from 'ws';
import { getTickleSession } from './ibkrRestClient';

const IBKR_WS_URL = process.env.IBKR_WS_URL || 'wss://localhost:5000/v1/api/ws';
const IBKR_INSECURE_SSL = process.env.IBKR_INSECURE_SSL === 'true';

class IbkrWs extends EventEmitter {
  private ws: WebSocket | null = null;
  private connecting = false;

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return;
    this.connecting = true;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(IBKR_WS_URL, {
        rejectUnauthorized: !IBKR_INSECURE_SSL,
      });

      this.ws.on('open', () => {
        this.emit('open');
      });

      this.ws.on('message', async (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          this.emit('message', parsed);
          if (parsed.message === 'waiting for session') {
            const session = await getTickleSession();
            this.ws?.send(JSON.stringify({ session }));
          }
        } catch (err) {
          this.emit('error', err);
        }
      });

      this.ws.on('error', (err) => {
        this.emit('error', err);
        this.connecting = false;
        reject(err);
      });

      this.ws.on('close', () => {
        this.emit('close');
        this.connecting = false;
      });

      // Resolve after first open event or a small delay
      this.once('open', () => {
        this.connecting = false;
        resolve();
      });
    });
  }

  isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  async subscribeMarketData(contractId: string): Promise<void> {
    if (!this.isOpen()) await this.connect();
    // TODO: Replace with real IBKR market data subscription payload per docs
    // Example scaffold:
    // this.ws?.send(JSON.stringify({
    //   type: 'md',
    //   data: { conid: contractId, fields: ['31', '84'] }
    // }));
    this.ws?.send(JSON.stringify({ note: 'subscription scaffold', conid: contractId }));
  }

  send(raw: object): void {
    if (this.isOpen()) {
      this.ws?.send(JSON.stringify(raw));
    }
  }
}

const singleton = new IbkrWs();
export default singleton;

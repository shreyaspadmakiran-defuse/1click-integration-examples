import * as fs from 'fs';
import * as path from 'path';
import { SwapStatus } from '../types/one-click';

/**
 * Persist the identifiers of every executed swap. The deposit address is
 * the universal lookup key for 1Click: with it you can always reconstruct
 * a swap via GET /v0/status, reconcile it on the Intents Explorer, or hand
 * it to support. Losing it means losing the ability to track the order,
 * so save the record the moment a non-dry quote is created.
 */
export interface SwapOrder {
  depositAddress: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  originAsset?: string;
  destinationAsset?: string;
  amountIn?: string;
  amountOut?: string;
  depositMemo?: string;
  txHash?: string;
  intentHash?: string;
  status?: SwapStatus;
}

export interface OrderStore {
  list(): SwapOrder[];
  get(depositAddress: string): SwapOrder | undefined;
  /** Insert or merge by depositAddress */
  save(order: Partial<SwapOrder> & { depositAddress: string }): SwapOrder;
}

/**
 * Minimal JSON-file implementation, good enough for the CLI and for
 * modeling the practice. In a real service this becomes a database table
 * keyed by depositAddress.
 */
export class FileOrderStore implements OrderStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  list(): SwapOrder[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  get(depositAddress: string): SwapOrder | undefined {
    return this.list().find((o) => o.depositAddress === depositAddress);
  }

  save(order: Partial<SwapOrder> & { depositAddress: string }): SwapOrder {
    const orders = this.list();
    const now = new Date().toISOString();
    const existing = orders.find((o) => o.depositAddress === order.depositAddress);

    let saved: SwapOrder;
    if (existing) {
      saved = { ...existing, ...order, updatedAt: now };
      orders[orders.indexOf(existing)] = saved;
    } else {
      saved = { correlationId: '', createdAt: now, ...order, updatedAt: now } as SwapOrder;
      orders.push(saved);
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(orders, null, 2));
    return saved;
  }
}

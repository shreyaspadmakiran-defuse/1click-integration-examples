import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileOrderStore } from '../src/utils/order-store';

describe('FileOrderStore', () => {
  let dir: string;
  let store: FileOrderStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-'));
    store = new FileOrderStore(path.join(dir, 'orders.json'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty and creates the file on first save', () => {
    expect(store.list()).toEqual([]);
    store.save({ depositAddress: 'addr1', correlationId: 'c1', originAsset: 'nep141:wrap.near' });
    expect(store.list()).toHaveLength(1);
    expect(store.get('addr1')?.correlationId).toBe('c1');
  });

  it('merges updates by depositAddress instead of duplicating', () => {
    store.save({ depositAddress: 'addr1', correlationId: 'c1', status: 'PENDING_DEPOSIT' });
    store.save({ depositAddress: 'addr1', status: 'SUCCESS', intentHash: 'h1' });

    const orders = store.list();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      depositAddress: 'addr1',
      correlationId: 'c1', // preserved from the first save
      status: 'SUCCESS',
      intentHash: 'h1',
    });
    expect(orders[0].updatedAt >= orders[0].createdAt).toBe(true);
  });

  it('keeps separate records per depositAddress', () => {
    store.save({ depositAddress: 'addr1', correlationId: 'c1' });
    store.save({ depositAddress: 'addr2', correlationId: 'c2' });
    expect(store.list()).toHaveLength(2);
    expect(store.get('addr2')?.correlationId).toBe('c2');
  });

  it('survives a corrupt file by returning empty instead of throwing', () => {
    const file = path.join(dir, 'orders.json');
    fs.writeFileSync(file, 'not json');
    expect(new FileOrderStore(file).list()).toEqual([]);
  });
});

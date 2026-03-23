import type { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import * as bankrollService from '../services/bankroll.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import logger from '../config/logger.js';
import { create as createAuditLog } from '../services/audit-log.service.js';

/** Fetch on-chain USDC balance for the Polymarket wallet via JSON-RPC. */
async function getOnChainBalance(): Promise<number | null> {
  const wallet = process.env.POLYMARKET_WALLET;
  const rpc = process.env.POLYGON_RPC_URL || 'https://1rpc.io/matic';
  if (!wallet) return null;

  const addr = wallet.toLowerCase().replace('0x', '').padStart(64, '0');
  const data = `0x70a08231${addr}`;
  // USDC.e (bridged) on Polygon
  const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
  const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

  try {
    const [bridgedRes, nativeRes] = await Promise.all([
      axios.post(rpc, { jsonrpc: '2.0', method: 'eth_call', params: [{ to: USDC_BRIDGED, data }, 'latest'], id: 1 }, { timeout: 5000 }),
      axios.post(rpc, { jsonrpc: '2.0', method: 'eth_call', params: [{ to: USDC_NATIVE, data }, 'latest'], id: 2 }, { timeout: 5000 }),
    ]);
    const bridged = parseInt(bridgedRes.data?.result || '0x0', 16) / 1e6;
    const native = parseInt(nativeRes.data?.result || '0x0', 16) / 1e6;
    return Math.round((bridged + native) * 100) / 100;
  } catch (err) {
    logger.warn('Failed to fetch on-chain balance', { error: (err as Error).message });
    return null;
  }
}

export async function getBankroll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [bankroll, onChainBalance] = await Promise.all([
      bankrollService.get(),
      getOnChainBalance(),
    ]);

    const data = bankroll ? { ...JSON.parse(JSON.stringify(bankroll)) } : null;
    if (data && onChainBalance !== null) {
      data.total_balance = onChainBalance;
      data.active_balance = onChainBalance;
      data.wallet_address = process.env.POLYMARKET_WALLET;
    }

    sendItem(res, data);
  } catch (err) {
    next(err);
  }
}

export async function updateBankroll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bankroll = await bankrollService.update(
      req.body as Parameters<typeof bankrollService.update>[0],
    );
    void createAuditLog(
      'bankroll_updated',
      'bankroll',
      undefined,
      { total_balance: bankroll.total_balance, active_balance: bankroll.active_balance },
      'user',
    ).catch(() => {});
    sendItem(res, bankroll);
  } catch (err) {
    next(err);
  }
}

export async function setBalance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { balance } = req.body as { balance: unknown };
    if (typeof balance !== 'number' || balance < 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_BALANCE', message: 'balance must be a non-negative number' },
      });
      return;
    }

    const current = await bankrollService.get();
    const deployed = Number(current?.deployed_balance ?? 0);

    const result = await bankrollService.update({
      total_balance: balance.toFixed(6),
      active_balance: Math.max(0, balance - deployed).toFixed(6),
      initial_deposit: balance.toFixed(6),
      // Carry through the rest unchanged so update() doesn't fail on required fields
      deployed_balance: current?.deployed_balance ?? '0',
      reserved_balance: current?.reserved_balance ?? '0',
      previous_balance: current?.total_balance ?? balance.toFixed(6),
      unrealized_pnl: current?.unrealized_pnl ?? '0',
      balance_delta_today: current?.balance_delta_today ?? '0',
      balance_delta_total: current?.balance_delta_total ?? '0',
    });

    void createAuditLog(
      'bankroll_balance_set',
      'bankroll',
      undefined,
      { balance, total_balance: result.total_balance, initial_deposit: result.initial_deposit },
      'user',
    ).catch(() => {});
    sendItem(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getBankrollHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);

    if (req.query.from && req.query.to) {
      const items = await bankrollService.getHistoryByDateRange(
        new Date(String(req.query.from)),
        new Date(String(req.query.to)),
      );
      res.json({
        success: true,
        data: items,
        meta: { total: items.length },
      });
      return;
    }

    const result = await bankrollService.getHistory({ page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

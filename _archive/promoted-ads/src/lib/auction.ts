// =============================================================================
// Auction — pure functions for ad auction logic
//
// Second-price (Vickrey) auction: vítěz platí cenu druhého-nejvyššího bidu
// + 1 haléř. Pokud je jen jeden kandidát, platí reserve price (= 50 % maxBid).
// =============================================================================

import type { AdCampaign, AuctionContext } from '../types/promoted-ads.types';

/**
 * Second-price auction: vítěz platí cenu druhého-nejvyššího bidu + 1 haléř.
 * Pokud je jen jedna kampaň, platí svůj reserve price (= 50 % maxBid).
 *
 * Vstup: kandidáti s efektivním bidem (už po úpravě o zbývající budget).
 */
export function runSecondPriceAuction(
  candidates: Array<{ campaign: AdCampaign; effectiveBid: number }>,
): { winner: AdCampaign; chargeAmountCzk: number } | null {
  if (candidates.length === 0) return null;

  // Seřaď sestupně podle effectiveBid. Stabilní — při shodě vyhraje dřívější
  // podle createdAt (deterministic tiebreak).
  const sorted = [...candidates].sort((a, b) => {
    if (b.effectiveBid !== a.effectiveBid) {
      return b.effectiveBid - a.effectiveBid;
    }
    return a.campaign.createdAt.getTime() - b.campaign.createdAt.getTime();
  });

  const top = sorted[0];
  if (!top || top.effectiveBid <= 0) return null;

  // Jediný kandidát → reserve price = 50 % max bidu (zaokrouhleno dolů).
  if (sorted.length === 1) {
    const reserve = Math.floor(top.campaign.maxCpcBidCzk / 2);
    // Reserve nesmí být 0 a nesmí přesáhnout effectiveBid.
    const charge = Math.max(1, Math.min(reserve, top.effectiveBid));
    return { winner: top.campaign, chargeAmountCzk: charge };
  }

  const second = sorted[1]!;

  // Second price + 1 haléř, ale neplatíme víc než náš vlastní effectiveBid
  // (ani víc než maxCpcBid kampaně).
  const secondPricePlusOne = second.effectiveBid + 1;
  const capped = Math.min(
    secondPricePlusOne,
    top.effectiveBid,
    top.campaign.maxCpcBidCzk,
  );

  return { winner: top.campaign, chargeAmountCzk: Math.max(1, capped) };
}

/**
 * Filtruje aktivní kampaně podle auction context (city, category, budget,
 * time window).
 */
export function filterEligibleCampaigns(
  campaigns: AdCampaign[],
  context: AuctionContext,
  now: Date,
): AdCampaign[] {
  return campaigns.filter((c) => {
    if (c.status !== 'active') return false;

    // Časové okno
    if (c.startsAt.getTime() > now.getTime()) return false;
    if (c.endsAt !== null && c.endsAt.getTime() <= now.getTime()) return false;

    // Budget
    if (c.spentTotalCzk >= c.totalBudgetCzk) return false;
    if (c.spentTodayCzk >= c.dailyBudgetCzk) return false;

    // City targeting — empty array = all cities
    if (c.targetCities.length > 0) {
      if (context.city === null) return false;
      if (!c.targetCities.includes(context.city)) return false;
    }

    // Category targeting
    if (c.targetCategories.length > 0) {
      if (context.category === null) return false;
      if (!c.targetCategories.includes(context.category)) return false;
    }

    return true;
  });
}

/**
 * Spočítá efektivní bid — může být snížený podle remaining daily/total budget.
 * Pokud zbývá méně haléřů než maxCpcBid, efektivní bid je ta menší částka
 * (kampaň nemůže zaplatit víc, než kolik má v budgetu).
 */
export function calculateEffectiveBid(
  campaign: AdCampaign,
  _now: Date,
): number {
  const remainingDaily = Math.max(0, campaign.dailyBudgetCzk - campaign.spentTodayCzk);
  const remainingTotal = Math.max(0, campaign.totalBudgetCzk - campaign.spentTotalCzk);
  const budgetCap = Math.min(remainingDaily, remainingTotal);
  return Math.min(campaign.maxCpcBidCzk, budgetCap);
}

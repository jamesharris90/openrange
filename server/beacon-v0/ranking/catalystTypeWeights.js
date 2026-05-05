const TIERS = {
  tier1: {
    weight: 2.0,
    keywords: [
      'fda approval', 'fda approves', 'pdufa', 'phase 3 success',
      'phase 3 met', 'phase 3 positive', 'definitive agreement',
      'contract award', 'awarded contract', '510(k) clearance',
      'ce mark', 'raised guidance', 'beat and raise', 'guidance raised',
      'breakthrough designation', 'priority review',
    ],
    clusters: ['FDA_APPROVAL', 'TRIAL_SUCCESS', 'M_AND_A_DEFINITIVE', 'CONTRACT_AWARD', 'REGULATORY_CLEARANCE', 'GUIDANCE_RAISE'],
  },
  tier2: {
    weight: 1.5,
    keywords: [
      'phase 2 results', 'phase 2 positive', 'earnings beat',
      'beats estimates', 'analyst upgrade', 'price target raised',
      'price target increased', 'insider buying', 'form 4 cluster',
      'partnership', 'collaboration agreement', 'strategic partnership',
      'short squeeze', 'high short interest',
    ],
    clusters: ['EARNINGS_BEAT', 'ANALYST_UPGRADE', 'PARTNERSHIP', 'INSIDER_BUYING', 'PHASE_2', 'SPINOFF'],
  },
  tier3: {
    weight: 1.0,
    keywords: [
      'rumored', 'reportedly', 'sources say', 'in talks',
      'considering', 'may acquire', 'social media', 'reddit',
      'wallstreetbets',
    ],
    clusters: ['NEWS_VOLUME', 'M_AND_A_RUMOR', 'SECTOR_ROTATION', 'GENERIC_NEWS', 'EARNINGS', 'ANALYST_ACTION', 'CATALYST_INTELLIGENCE'],
  },
  tier4: {
    weight: 0.5,
    keywords: ['old news', 'reiterates', 'maintains rating'],
    clusters: ['LOW_CONFIDENCE', 'SINGLE_SOURCE'],
  },
};

TIERS.tier1.clusters.push('IMMINENT_CATALYST');

function classifyCatalyst(catalystText, cluster) {
  const normalizedCluster = typeof cluster === 'string' ? cluster.trim().toUpperCase() : '';
  if (normalizedCluster) {
    for (const tier of Object.values(TIERS)) {
      if (tier.clusters.includes(normalizedCluster)) {
        return tier.weight;
      }
    }
  }

  const normalizedText = typeof catalystText === 'string' ? catalystText.toLowerCase() : '';
  let matchedWeight = null;
  if (normalizedText) {
    for (const tier of Object.values(TIERS)) {
      if (tier.keywords.some((keyword) => normalizedText.includes(keyword))) {
        matchedWeight = matchedWeight == null ? tier.weight : Math.max(matchedWeight, tier.weight);
      }
    }
  }

  return matchedWeight == null ? TIERS.tier3.weight : matchedWeight;
}

module.exports = {
  ...TIERS,
  classifyCatalyst,
};
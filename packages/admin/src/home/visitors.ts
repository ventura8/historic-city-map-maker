/**
 * Home's Visitors card as a lazy chunk of its own (`visitors`): the `<hcm-home-visitors>` element only. Its numbers are the
 * Statistics page's last read of this session (`StatisticsSource.latest`, `DECISIONS-for-review.md` §203): Home never asks
 * Google itself, and before any read the card says where to allow it.
 */
export { defineHcmHomeVisitors } from '@hcm/ui/admin/home/visitors';

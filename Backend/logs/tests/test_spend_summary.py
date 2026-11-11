"""B6: month-to-date spend, through the same conversion and filter the cap uses."""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from agents.models import SubAgent
from agents.spend import aggregate_rupees, rupees_for
from logs.costs import record
from logs.models import ExecutionLog
from logs.queries import spend_this_month

URL = '/api/logs/spend/summary/'


def _month_start():
    return timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


class SpendThisMonthTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='spender', password='pw')
        self.agent = SubAgent.objects.create(user=self.user, name='Spender')

    def _run(self, *, caller='api', created_at=None, **kwargs):
        defaults = dict(
            user=self.user, subagent=self.agent, status='completed',
            caller=caller, tokens_used=0,
        )
        defaults.update(kwargs)
        run = ExecutionLog.objects.create(**defaults)
        if created_at is not None:
            ExecutionLog.objects.filter(pk=run.pk).update(created_at=created_at)
        return run

    def test_total_is_the_cap_conversion_over_this_months_runs(self):
        self._run(cost_usd=Decimal('0.250000'), cost_source='billed', tokens_used=1000)
        self._run(tokens_used=400_000, cost_source='unpriced')

        cap_queryset = (ExecutionLog.objects
                        .filter(user=self.user, subagent=self.agent,
                                created_at__gte=_month_start())
                        .exclude(caller='eval'))
        self.assertEqual(spend_this_month(self.user)['month_rupees'],
                         aggregate_rupees(cap_queryset))

    def test_unpriced_runs_are_charged_not_free(self):
        self._run(tokens_used=2_000_000, cost_source='unpriced')
        self.assertEqual(spend_this_month(self.user)['month_rupees'],
                         rupees_for(2_000_000))
        self.assertGreater(spend_this_month(self.user)['month_rupees'], 0)

    def test_eval_traffic_is_excluded_as_the_cap_excludes_it(self):
        self._run(tokens_used=1_000_000, cost_source='unpriced')
        before = spend_this_month(self.user)['month_rupees']
        self._run(caller='eval', tokens_used=5_000_000, cost_source='unpriced')
        after = spend_this_month(self.user)
        self.assertEqual(after['month_rupees'], before)
        self.assertNotIn('eval', after['by_caller'])

    def test_last_months_runs_are_not_this_month(self):
        self._run(tokens_used=3_000_000, cost_source='unpriced',
                  created_at=_month_start() - timedelta(days=2))
        self.assertEqual(spend_this_month(self.user)['month_rupees'], 0)

    def test_ledger_spend_counts_but_rolled_image_spend_does_not_twice(self):
        run = self._run(cost_usd=Decimal('0.100000'), cost_source='billed', tokens_used=0)
        record(user=self.user, kind='sms', amount_inr=7, execution=run)
        after_sms = spend_this_month(self.user)['month_rupees']
        self.assertGreaterEqual(after_sms, 7)
        # An image is already inside cost_usd, so its ledger row must not add again.
        record(user=self.user, kind='image', amount_inr=500, execution=run)
        self.assertEqual(spend_this_month(self.user)['month_rupees'], after_sms)

    def test_by_caller_splits_the_same_runs(self):
        self._run(caller='chat', tokens_used=100_000, cost_source='unpriced')
        self._run(caller='trigger', tokens_used=200_000, cost_source='unpriced')
        by_caller = spend_this_month(self.user)['by_caller']
        self.assertEqual(set(by_caller), {'chat', 'trigger'})
        self.assertEqual(by_caller['chat'], rupees_for(100_000))
        self.assertEqual(by_caller['trigger'], rupees_for(200_000))

    def test_another_users_runs_are_not_counted(self):
        other = User.objects.create_user(username='other', password='pw')
        ExecutionLog.objects.create(user=other, status='completed',
                                    tokens_used=9_000_000, cost_source='unpriced')
        self.assertEqual(spend_this_month(self.user)['month_rupees'], 0)


class SpendSummaryEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='endpoint', password='pw')
        self.client = APIClient()

    def test_requires_authentication(self):
        response = self.client.get(URL)
        self.assertIn(response.status_code, (401, 403))

    def test_response_shape(self):
        self.client.force_authenticate(user=self.user)
        ExecutionLog.objects.create(user=self.user, status='completed', caller='api',
                                    tokens_used=1_000_000, cost_source='unpriced')
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {'month_rupees', 'by_caller'})
        self.assertIsInstance(response.data['month_rupees'], int)
        self.assertEqual(response.data['by_caller'], {'api': rupees_for(1_000_000)})

    def test_answer_is_cached_for_a_minute_per_user(self):
        self.client.force_authenticate(user=self.user)
        first = self.client.get(URL).data
        ExecutionLog.objects.create(user=self.user, status='completed', caller='api',
                                    tokens_used=9_000_000, cost_source='unpriced')
        self.assertEqual(self.client.get(URL).data, first)
        cache.clear()
        self.assertGreater(self.client.get(URL).data['month_rupees'], first['month_rupees'])

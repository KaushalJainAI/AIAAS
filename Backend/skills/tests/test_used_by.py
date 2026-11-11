"""B9: `used_by` on skills, counted from the user's agents' `agent_context['skills']`."""
from django.contrib.auth.models import User
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APITestCase

from agents.models import SubAgent
from skills.models import Skill
from skills.serializers import used_by_counts


def _skill(user, title):
    return Skill.objects.create(user=user, title=title, content='do the thing')


def _agent(user, name, skill_ids):
    return SubAgent.objects.create(
        user=user, name=name, agent_context={'skills': list(skill_ids)},
    )


class UsedByTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='skillowner', password='pw')
        self.other = User.objects.create_user(username='someoneelse', password='pw')
        self.client.force_authenticate(user=self.user)
        self.writing = _skill(self.user, 'Writing')
        self.research = _skill(self.user, 'Research')
        self.unused = _skill(self.user, 'Unused')

    def _by_title(self, response):
        data = response.data['results'] if isinstance(response.data, dict) else response.data
        return {row['title']: row['used_by'] for row in data}

    def test_counts_the_users_agents_that_name_each_skill(self):
        _agent(self.user, 'Writer', [self.writing.id, self.research.id])
        _agent(self.user, 'Reader', [self.research.id])
        counts = used_by_counts(self.user)
        self.assertEqual(counts[self.writing.id], 1)
        self.assertEqual(counts[self.research.id], 2)
        self.assertEqual(counts.get(self.unused.id, 0), 0)

    def test_list_carries_used_by_on_every_item(self):
        _agent(self.user, 'Writer', [self.writing.id])
        response = self.client.get(reverse('skill-list'))
        self.assertEqual(response.status_code, 200)
        titles = self._by_title(response)
        self.assertEqual(titles, {'Writing': 1, 'Research': 0, 'Unused': 0})

    def test_another_users_agents_do_not_count(self):
        _agent(self.other, 'Their agent', [self.writing.id])
        response = self.client.get(reverse('skill-list'))
        self.assertEqual(self._by_title(response)['Writing'], 0)

    def test_list_reads_agents_in_one_query_whatever_the_skill_count(self):
        for i in range(6):
            _skill(self.user, f'Extra {i}')
        for n in range(3):
            _agent(self.user, f'Agent {n}', [self.writing.id])
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(reverse('skill-list'))
        self.assertEqual(response.status_code, 200)
        agent_reads = [q for q in ctx.captured_queries
                       if 'orchestrator_subagent' in q['sql']]
        self.assertEqual(len(agent_reads), 1)

    def test_a_malformed_skill_reference_is_ignored_not_fatal(self):
        SubAgent.objects.create(
            user=self.user, name='Odd',
            agent_context={'skills': ['not-an-id', None, self.writing.id]},
        )
        response = self.client.get(reverse('skill-list'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._by_title(response)['Writing'], 1)

    def test_a_single_skill_response_carries_used_by(self):
        _agent(self.user, 'Writer', [self.writing.id])
        response = self.client.get(reverse('skill-detail', args=[self.writing.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['used_by'], 1)

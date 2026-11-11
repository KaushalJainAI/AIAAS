"""B7: credential health and token expiry on the credentials serializer."""
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from credentials.models import Credential, CredentialType
from credentials.serializers import CredentialSerializer, credential_health


def _ctype():
    # The table is not empty at test start (a migration seeds it), so update.
    ctype, _ = CredentialType.objects.update_or_create(
        slug='health-test',
        defaults={'name': 'Health test', 'service_identifier': 'health-test',
                  'auth_method': 'api_key', 'fields_schema': []},
    )
    return ctype


class CredentialHealthTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='health', password='pw')
        self.ctype = _ctype()
        self.now = timezone.now()

    def _cred(self, **kwargs):
        defaults = dict(user=self.user, credential_type=self.ctype,
                        name=f'cred-{Credential.objects.count()}', is_verified=True)
        defaults.update(kwargs)
        cred = Credential(**defaults)
        cred.set_credential_data({'k': 'v'})
        return cred

    def test_verified_and_healthy_is_ok(self):
        cred = self._cred(token_expires_at=self.now + timedelta(days=30))
        self.assertEqual(credential_health(cred, now=self.now), 'ok')

    def test_a_recorded_error_is_failed_whatever_else_holds(self):
        cred = self._cred(last_error='Token refresh failed: 400',
                          token_expires_at=self.now - timedelta(days=1))
        self.assertEqual(credential_health(cred, now=self.now), 'failed')

    def test_an_unverified_credential_is_unverified(self):
        cred = self._cred(is_verified=False)
        self.assertEqual(credential_health(cred, now=self.now), 'unverified')

    def test_a_token_that_lapses_within_seven_days_with_no_refresh_is_expiring(self):
        cred = self._cred(token_expires_at=self.now + timedelta(days=6))
        self.assertEqual(credential_health(cred, now=self.now), 'expiring')

    def test_a_lapsed_token_with_no_refresh_is_expiring_not_ok(self):
        cred = self._cred(token_expires_at=self.now - timedelta(hours=1))
        self.assertEqual(credential_health(cred, now=self.now), 'expiring')

    def test_beyond_seven_days_is_not_expiring(self):
        cred = self._cred(token_expires_at=self.now + timedelta(days=8))
        self.assertEqual(credential_health(cred, now=self.now), 'ok')

    def test_a_refresh_token_renews_the_access_token_so_it_is_not_expiring(self):
        # An OAuth access token lives about an hour; with a refresh token it is
        # renewed on use, so reading it as "expiring" would flag every account.
        cred = self._cred(token_expires_at=self.now + timedelta(hours=1),
                          refresh_token=b'encrypted-refresh')
        self.assertEqual(credential_health(cred, now=self.now), 'ok')

    def test_failed_outranks_unverified_and_expiring(self):
        cred = self._cred(is_verified=False, last_error='boom',
                          token_expires_at=self.now + timedelta(days=1))
        self.assertEqual(credential_health(cred, now=self.now), 'failed')


class CredentialSerializerHealthTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='serhealth', password='pw')
        self.ctype = _ctype()

    def test_serializer_exposes_expiry_and_health(self):
        expires = timezone.now() + timedelta(days=2)
        cred = Credential(user=self.user, credential_type=self.ctype, name='exp',
                          is_verified=True, token_expires_at=expires)
        cred.set_credential_data({})
        cred.save()
        data = CredentialSerializer(cred).data
        self.assertEqual(parse_datetime(data['token_expires_at']), expires)
        self.assertEqual(data['health'], 'expiring')

    def test_token_expires_at_and_health_are_read_only(self):
        cred = Credential(user=self.user, credential_type=self.ctype, name='ro',
                          is_verified=True)
        cred.set_credential_data({})
        cred.save()
        serializer = CredentialSerializer(
            cred, data={'name': 'ro', 'credential_type': self.ctype.pk,
                        'token_expires_at': '2000-01-01T00:00:00Z', 'health': 'failed'},
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        cred.refresh_from_db()
        self.assertIsNone(cred.token_expires_at)
        self.assertEqual(CredentialSerializer(cred).data['health'], 'ok')

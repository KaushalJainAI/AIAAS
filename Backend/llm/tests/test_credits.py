"""
Credits are spent on the platform's key, and only there.

The field existed for months with nothing reading or writing it, so every
account could spend without limit on the key the platform pays for. These pin
the three rules in `llm/credits.py`: the platform key is metered and a
user's own key is not, free models are never metered, and an empty balance is
refused at preflight rather than after the turn has started.
"""
from __future__ import annotations


from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from core.models import UserProfile
from llm import access, credits
from llm.models import AIModel, AIProvider
from llm.testing import scripted_model, text, usage

PAID = "t/paid-model"
FREE = "t/free-model"


class CreditsTestBase(TestCase):
    def setUp(self):
        cache.clear()
        provider, _ = AIProvider.objects.update_or_create(
            slug="openrouter", defaults={"name": "OpenRouter", "is_active": True},
        )
        for value, free in ((PAID, False), (FREE, True)):
            AIModel.objects.update_or_create(
                value=value,
                defaults={"provider": provider, "name": value, "is_active": True, "is_free": free},
            )
        self.user = get_user_model().objects.create_user("credits-user", password="x")
        self.profile = UserProfile.objects.create(user=self.user, credits_remaining=5)

    def own_key(self) -> None:
        """A verified OpenRouter key of the user's own, stored as the app stores it."""
        from credentials.models import Credential, CredentialType
        from credentials.resolution import slugs_for

        kind = CredentialType.objects.filter(slug__in=slugs_for("openrouter")).first()
        credential = Credential.objects.create(
            user=self.user, credential_type=kind, name="Mine",
            is_verified=True, is_active=True)
        credential.set_credential_data({"apiKey": "sk-or-users-own"})
        credential.save()
        cache.clear()

    def balance(self) -> tuple[int, int]:
        self.profile.refresh_from_db()
        return self.profile.credits_remaining, self.profile.credits_used_total


class ArithmeticTests(CreditsTestBase):
    def test_rounds_up_so_no_metered_call_is_free(self):
        self.assertEqual(credits.credits_for(1), 1)
        self.assertEqual(credits.credits_for(1_000), 1)
        self.assertEqual(credits.credits_for(1_001), 2)
        self.assertEqual(credits.credits_for(0), 0)

    def test_charge_subtracts_and_records_total(self):
        charged = async_to_sync(credits.charge)(user_id=self.user.id, model=PAID, tokens=2_500)
        self.assertEqual(charged, 3)
        self.assertEqual(self.balance(), (2, 3))

    def test_balance_floors_at_zero(self):
        async_to_sync(credits.charge)(user_id=self.user.id, model=PAID, tokens=50_000)
        self.assertEqual(self.balance()[0], 0)

    def test_free_models_are_never_charged(self):
        charged = async_to_sync(credits.charge)(user_id=self.user.id, model=FREE, tokens=50_000)
        self.assertEqual(charged, 0)
        self.assertEqual(self.balance(), (5, 0))

    def test_unknown_model_is_metered(self):
        self.assertFalse(async_to_sync(credits.is_free_model)("t/not-in-catalogue"))


class PreflightTests(CreditsTestBase):
    def _preflight(self, model: str, *, own_key: bool = False):
        if own_key:
            self.own_key()
        # The scripted model only supplies the platform key here; preflight
        # makes no model call.
        with scripted_model():
            async_to_sync(access.preflight)(provider="openrouter", model=model, user_id=self.user.id)

    def test_empty_balance_is_refused_before_the_turn_starts(self):
        UserProfile.objects.filter(pk=self.profile.pk).update(credits_remaining=0)
        with self.assertRaises(access.LLMQuotaExhausted):
            self._preflight(PAID)

    def test_empty_balance_still_allows_free_models(self):
        UserProfile.objects.filter(pk=self.profile.pk).update(credits_remaining=0)
        self._preflight(FREE)

    def test_empty_balance_still_allows_the_users_own_key(self):
        UserProfile.objects.filter(pk=self.profile.pk).update(credits_remaining=0)
        self._preflight(PAID, own_key=True)

    def test_a_user_with_no_profile_is_not_blocked(self):
        self.profile.delete()
        self._preflight(PAID)


class FunnelChargesTests(CreditsTestBase):
    """The real funnel decides who pays: the provider reports 1,500 tokens,
    and only a call made on the platform's key is charged for them."""

    def _run(self, fn):
        with scripted_model(text("ok", usage=usage(1_500, 0)), model=PAID) as model:
            async def go():
                kwargs = dict(provider="openrouter", model=PAID, prompt="hi",
                              system_message="", user_id=self.user.id)
                if fn == "complete":
                    await access.complete(**kwargs)
                else:
                    async for _ in access.stream(**kwargs):
                        pass
            async_to_sync(go)()
        return model.requests[0]

    def test_complete_on_the_platform_key_is_charged(self):
        sent = self._run("complete")
        self.assertEqual(sent.api_key, "scripted-test-key")
        self.assertEqual(self.balance(), (3, 2))

    def test_stream_on_the_platform_key_is_charged(self):
        self._run("stream")
        self.assertEqual(self.balance(), (3, 2))

    def test_the_users_own_key_is_not_charged(self):
        self.own_key()
        self.assertEqual(self._run("complete").api_key, "sk-or-users-own")
        self._run("stream")
        self.assertEqual(self.balance(), (5, 0))

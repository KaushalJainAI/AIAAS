from collections import Counter

from rest_framework import serializers
from .models import Skill

MAX_SKILL_CONTENT_WORDS = 10_000

def validate_skill_content(value):
    if len(value.split()) > MAX_SKILL_CONTENT_WORDS:
        raise serializers.ValidationError(
            f'Skill content must be at most {MAX_SKILL_CONTENT_WORDS} words.'
        )
    return value

def used_by_counts(user) -> Counter:
    """How many of `user`'s agents name each skill, as `{skill_id: count}`.

    An agent names a skill in `agent_context['skills']` (see `agents/config.py`).
    One query for the whole list, tallied in Python: the id sits inside a JSON
    list, which has no portable aggregate across SQLite and Postgres, and an
    account has few enough agents that reading their configs is cheap.

    The agents import is deferred. Skills is a lower layer, and this reads the
    agent's model row only; it never reaches the runtime or the views.
    """
    from agents.models import SubAgent

    counts: Counter = Counter()
    contexts = SubAgent.objects.filter(user=user).values_list('agent_context', flat=True)
    for context in contexts.iterator():
        if not isinstance(context, dict):
            continue
        for raw in set(context.get('skills') or []):
            try:
                counts[int(raw)] += 1
            except (TypeError, ValueError):
                continue
    return counts


class SkillSerializer(serializers.ModelSerializer):
    author = serializers.CharField(source='author_name', read_only=True)
    isShared = serializers.BooleanField(source='is_shared', default=False)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)
    content = serializers.CharField(validators=[validate_skill_content])
    used_by = serializers.SerializerMethodField()

    class Meta:
        model = Skill
        fields = ['id', 'title', 'description', 'content', 'author', 'isShared', 'category', 'updatedAt', 'used_by']
        read_only_fields = ['id', 'author', 'updatedAt', 'used_by']

    def get_used_by(self, obj) -> int:
        # List and search views compute the tally once and pass it in context,
        # so a page of skills costs one query. A single-skill response falls
        # back to computing it here.
        counts = self.context.get('used_by')
        if counts is None:
            counts = used_by_counts(self.context['request'].user)
        return counts.get(obj.id, 0)

    def create(self, validated_data):
        return super().create(validated_data)

class SkillSearchSerializer(serializers.Serializer):
    """Serializer for skill search parameters."""
    query = serializers.CharField(required=False, allow_blank=True, default='')
    category = serializers.CharField(required=False, allow_null=True)
    tab = serializers.ChoiceField(choices=['mine', 'public'], default='mine')
    page = serializers.IntegerField(default=1, min_value=1)
    page_size = serializers.IntegerField(default=12, min_value=1, max_value=100)

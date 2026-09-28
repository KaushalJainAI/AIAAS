from django.contrib import admin

from .models import Solution, SolutionReview


class SolutionReviewInline(admin.TabularInline):
    model = SolutionReview
    extra = 0
    readonly_fields = ['kind', 'user', 'model', 'reason', 'created_at']
    can_delete = False


@admin.register(Solution)
class SolutionAdmin(admin.ModelAdmin):
    list_display = ['id', 'problem', 'org', 'shared', 'status', 'doubtful',
                    'confirmations', 'failures', 'volatility', 'valid_as_of']
    list_filter = ['status', 'shared', 'doubtful', 'volatility', 'captured_by']
    search_fields = ['problem', 'symptoms']
    readonly_fields = ['org', 'author', 'source_session', 'source_message_id',
                       'embed_version', 'created_at', 'updated_at']
    inlines = [SolutionReviewInline]

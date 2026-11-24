from django.urls import path

from . import views

app_name = 'messaging'

urlpatterns = [
    # Provider callbacks. Unauthenticated by design — verification is the
    # provider signature plus the secret in the path — and every refusal is
    # the same 404.
    path('hooks/<str:channel>/<str:secret>/', views.message_hook, name='message_hook'),
    # What the Connections page renders: every channel with this caller's
    # setup state, so supported tools are visible before they are connected.
    path('channels/', views.channel_list, name='channel_list'),
    path('accounts/', views.account_create, name='account_create'),
    path('accounts/<int:account_id>/register/', views.account_register,
         name='account_register'),
    # The send window: messages waiting to go out (docs/UNDO_PLAN.md §5).
    path('holds/', views.hold_list, name='hold_list'),
    path('holds/<int:hold_id>/cancel/', views.hold_cancel, name='hold_cancel'),
    path('holds/<int:hold_id>/send-now/', views.hold_send_now, name='hold_send_now'),
]

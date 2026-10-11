from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import chatgpt_views, views

router = DefaultRouter()
router.register(r'types', views.CredentialTypeViewSet, basename='credential-types')
router.register(r'oauth/google', views.GoogleCredentialOAuthViewSet, basename='google-credentials')
router.register(r'logs', views.CredentialAuditLogViewSet, basename='credential-audit-logs')
router.register(r'', views.CredentialViewSet, basename='credentials')

urlpatterns = [
    # Before the router: its detail routes (`<pk>/<action>/`) would otherwise
    # read `chatgpt` as a credential id.
    path('chatgpt/start/', chatgpt_views.start, name='chatgpt-start'),
    path('chatgpt/status/', chatgpt_views.status, name='chatgpt-status'),
    path('chatgpt/disconnect/', chatgpt_views.disconnect, name='chatgpt-disconnect'),
    path('', include(router.urls)),
]

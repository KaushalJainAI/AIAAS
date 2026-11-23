from django.urls import path

from . import views

urlpatterns = [
    path('status/', views.browser_status, name='browser-status'),
    path('preview/', views.browser_preview, name='browser-preview'),
    path('frames/<str:frame_id>/', views.browser_frame, name='browser-frame'),
]

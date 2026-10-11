"""The one ChatGPT route outside `/api/`: OpenAI's loopback redirect target."""
from django.urls import path

from . import chatgpt_views

urlpatterns = [
    path('callback', chatgpt_views.callback, name='chatgpt-callback'),
]

from django.urls import path

from . import views

app_name = 'solutions'

urlpatterns = [
    path('', views.SolutionListView.as_view(), name='list'),
    path('<int:solution_id>/', views.SolutionDetailView.as_view(), name='detail'),
    path('<int:solution_id>/review/', views.SolutionReviewView.as_view(), name='review'),
]

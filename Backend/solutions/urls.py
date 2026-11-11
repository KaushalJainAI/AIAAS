from django.urls import path

from . import views

app_name = 'solutions'

urlpatterns = [
    path('', views.SolutionListView.as_view(), name='list'),
    path('import/', views.SolutionImportView.as_view(), name='import'),
    path('insights/', views.SolutionInsightsView.as_view(), name='insights'),
    path('<int:solution_id>/', views.SolutionDetailView.as_view(), name='detail'),
    path('<int:solution_id>/review/', views.SolutionReviewView.as_view(), name='review'),
    path('<int:solution_id>/publish/', views.SolutionPublishView.as_view(), name='publish'),
    path('<int:solution_id>/discard/', views.SolutionDiscardView.as_view(), name='discard'),
    path('<int:solution_id>/approve/', views.SolutionApproveView.as_view(), name='approve'),
    path('<int:solution_id>/send-back/', views.SolutionSendBackView.as_view(), name='send-back'),
]

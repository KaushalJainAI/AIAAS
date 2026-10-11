/**
 * Continue with ChatGPT — sign in once and the `chatgpt` provider spends the
 * usage included in your own ChatGPT plan.
 *
 * Three calls, mirroring `Backend/credentials/chatgpt_views.py`. The sign-in
 * itself happens in a popup that OpenAI redirects to the backend, not to this
 * app, so nothing here ever sees a code or a token: the opener learns the
 * outcome by asking `status`.
 */
import apiClient from './client';

export interface ChatGPTPlanStatus {
  /** Off wherever the app is hosted for other people; then nothing is drawn. */
  enabled: boolean;
  connected: boolean;
  email: string;
  /** A sign-in existed and has ended (revoked, expired): ask to sign in again. */
  needs_sign_in: boolean;
  manage_usage_url: string;
}

const chatgptPlanService = {
  status: async (): Promise<ChatGPTPlanStatus> =>
    (await apiClient.get('/credentials/chatgpt/status/')).data,

  /** The URL to open in a popup. Rejects with the server's sentence. */
  start: async (): Promise<string> =>
    (await apiClient.post('/credentials/chatgpt/start/')).data.authorize_url,

  disconnect: async (): Promise<void> => {
    await apiClient.post('/credentials/chatgpt/disconnect/');
  },
};

export default chatgptPlanService;

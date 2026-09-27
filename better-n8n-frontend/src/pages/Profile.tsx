import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Mail,
  Shield,
  CreditCard,
  LogOut,
  Save,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../contexts/authState';
import authService from '../api/auth';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { Spinner } from '../components/ui/Loading';
import SidebarMenuButton from '../components/layout/SidebarMenuButton';

export default function Profile() {
  const { user, logout, refreshUser, isLoading } = useAuth();
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [passwordStep, setPasswordStep] = useState<'start' | 'otp' | 'reset'>('start');
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    otpCode: '',
    verificationToken: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);

  // Follows the account's name and email when they change (after a save, or
  // once the user loads). During render, so the form never paints stale.
  const [seenAccount, setSeenAccount] = useState<readonly [string | undefined, string | undefined] | null>(null);
  if (!seenAccount || seenAccount[0] !== user?.name || seenAccount[1] !== user?.email) {
    setSeenAccount([user?.name, user?.email]);
    setFormData({
      name: user?.name || '',
      email: user?.email || '',
    });
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      const [firstName, ...lastNameParts] = formData.name.trim().split(/\s+/);
      await authService.updateProfile({
        user: {
          first_name: firstName || '',
          last_name: lastNameParts.join(' '),
          email: formData.email.trim(),
        },
      });
      await refreshUser();
      setSuccess('Profile updated successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch {
      setError('Failed to logout');
    }
  };

  const requestPasswordOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsPasswordSaving(true);
    try {
      const response = await authService.requestPasswordChangeOTP(passwordForm.oldPassword);
      setSuccess(response.detail);
      setPasswordStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const verifyPasswordOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsPasswordSaving(true);
    try {
      const response = await authService.verifyPasswordChangeOTP(passwordForm.otpCode);
      setPasswordForm({ ...passwordForm, verificationToken: response.verification_token });
      setSuccess(response.detail);
      setPasswordStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired OTP');
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const submitPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsPasswordSaving(true);
    try {
      const response = await authService.changePassword({
        old_password: passwordForm.oldPassword,
        verification_token: passwordForm.verificationToken,
        new_password: passwordForm.newPassword,
        confirm_password: passwordForm.confirmPassword,
      });
      setSuccess(response.detail);
      setPasswordStep('start');
      setPasswordForm({ oldPassword: '', otpCode: '', verificationToken: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'pro': return 'text-purple-500 bg-purple-500/10 border-purple-500/20';
      case 'enterprise': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      default: return 'text-muted-foreground bg-muted border-border';
    }
  };

  const getTierLabel = (tier: string) => {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header — menu button is in-flow (same 40px slot as every title
            bar), so it centres against the back button instead of floating
            over it. */}
        <div className="flex items-center gap-2 md:gap-4 min-h-14">
          <SidebarMenuButton />

          <button 
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Profile</h1>
            <p className="text-muted-foreground">Manage your account settings</p>
          </div>
        </div>

        {/* Status Messages */}
        {error && <Alert tone="error">{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}

        {/* Profile Card */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl border border-border">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : user?.email?.slice(0, 2).toUpperCase() || '??'}
            </div>
            <div>
              <h2 className="text-xl font-semibold">{user?.name || 'User'}</h2>
              <p className="text-muted-foreground">{user?.email}</p>
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border mt-1 ${getTierColor(user?.tier || 'free')}`}>
                <Shield className="w-3 h-3" />
                {getTierLabel(user?.tier || 'free')} Plan
              </div>
            </div>
          </div>

          {/* Account Stats */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <CreditCard className="w-4 h-4" />
                <span className="text-sm">Credits remaining</span>
              </div>
              <p className="text-2xl font-bold">{user?.credits ?? 0}</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <User className="w-4 h-4" />
                <span className="text-sm">Member since</span>
              </div>
              <p className="text-2xl font-bold">
                {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'N/A'}
              </p>
            </div>
          </div>

          {/* Edit Form */}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="name">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 pl-10 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-colors duration-150"
                  placeholder="Your name"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="email">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 pl-10 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-colors duration-150"
                  placeholder="your@email.com"
                  disabled // Email typically can't be changed
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
            </div>

            <Button
              type="submit"
              loading={isSaving}
            >
              {!isSaving && (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
              {isSaving && <>Saving...</>}
            </Button>
          </form>
        </div>

        <div className="bg-card border border-border/60 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Change password</h3>

          {passwordStep === 'start' && (
            <form onSubmit={requestPasswordOTP} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="old-password">Current password</label>
                <input
                  id="old-password"
                  type="password"
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  required
                />
              </div>
              <Button loading={isPasswordSaving}>
                {!isPasswordSaving && <>Send OTP</>}
                {isPasswordSaving && <>Sending...</>}
              </Button>
            </form>
          )}

          {passwordStep === 'otp' && (
            <form onSubmit={verifyPasswordOTP} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="password-otp">Email OTP</label>
                <input
                  id="password-otp"
                  inputMode="numeric"
                  maxLength={6}
                  value={passwordForm.otpCode}
                  onChange={(e) => setPasswordForm({ ...passwordForm, otpCode: e.target.value.replace(/\D/g, '') })}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-center tracking-[0.4em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  required
                />
              </div>
              <Button disabled={isPasswordSaving || passwordForm.otpCode.length !== 6} loading={isPasswordSaving}>
                {!isPasswordSaving && <>Verify OTP</>}
                {isPasswordSaving && <>Verifying...</>}
              </Button>
            </form>
          )}

          {passwordStep === 'reset' && (
            <form onSubmit={submitPasswordChange} className="space-y-4">
              <input type="password" placeholder="New password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" required />
              <input type="password" placeholder="Confirm new password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" required />
              <Button loading={isPasswordSaving}>
                {!isPasswordSaving && <>Update Password</>}
                {isPasswordSaving && <>Updating...</>}
              </Button>
            </form>
          )}
        </div>

        {/* Danger Zone */}
        <div className="bg-card border border-border/60 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 text-destructive">Account actions</h3>
          
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div>
              <p className="font-medium">Sign out</p>
              <p className="text-sm text-muted-foreground">Sign out of your account on this device</p>
            </div>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors font-medium"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 entrance-overlay">
          <div className="bg-card border border-border/60 rounded-lg shadow-lg w-full max-w-sm mx-4 p-6 entrance-modal">
            <h3 className="text-lg font-semibold mb-2">Sign out?</h3>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to sign out of your account?
            </p>
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 border border-border/60 rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleLogout}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

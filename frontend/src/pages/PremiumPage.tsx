import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Crown, Loader2, ArrowLeft, CreditCard, Sparkles } from 'lucide-react';
import { apiUrl } from '../config/apiBase';
import { useAppStore } from '../store/useAppStore';
import { ensureValidAccessToken } from '../utils/authSession';

type BillingPublic = {
  payments_enabled: boolean;
  stripe_publishable_key?: string | null;
  stripe_configured: boolean;
};

type BillingStatus = {
  is_premium: boolean;
  premium_source?: string | null;
  premium_until?: string | null;
  payments_enabled: boolean;
  can_subscribe: boolean;
};

export default function PremiumPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, isAnonymous, isPremium, applyPremiumSync } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [publicCfg, setPublicCfg] = useState<BillingPublic | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const success = searchParams.get('success') === '1';
  const canceled = searchParams.get('canceled') === '1';

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const pubRes = await fetch(apiUrl('/api/settings/billing'));
      const pub = (await pubRes.json()) as BillingPublic;
      setPublicCfg(pub);

      if (token?.trim()) {
        const authTok = (await ensureValidAccessToken()) ?? token;
        const stRes = await fetch(apiUrl('/api/billing/status'), {
          headers: { Authorization: `Bearer ${authTok}` },
        });
        if (stRes.ok) {
          const st = (await stRes.json()) as BillingStatus;
          setStatus(st);
          applyPremiumSync({
            is_premium: st.is_premium,
            premium_source: st.premium_source ?? null,
          });
        }
      }
    } catch {
      setMessage('No se pudo cargar la información de suscripción.');
    } finally {
      setLoading(false);
    }
  }, [token, applyPremiumSync]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (success) {
      setMessage('¡Pago recibido! Tu Premium se activará en unos segundos.');
      void load();
    } else if (canceled) {
      setMessage('Pago cancelado. Puedes intentarlo cuando quieras.');
    }
  }, [success, canceled, load]);

  const startCheckout = async () => {
    const authTok = (await ensureValidAccessToken()) ?? token;
    if (!authTok) return;
    setCheckoutLoading(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl('/api/billing/create-checkout-session'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${authTok}` },
      });
      const data = (await res.json()) as { url?: string; detail?: string };
      if (!res.ok || !data.url) {
        setMessage(typeof data.detail === 'string' ? data.detail : 'No se pudo iniciar el pago');
        return;
      }
      window.location.href = data.url;
    } catch {
      setMessage('Error de conexión al iniciar el pago');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const openPortal = async () => {
    const authTok = (await ensureValidAccessToken()) ?? token;
    if (!authTok) return;
    setPortalLoading(true);
    try {
      const res = await fetch(apiUrl('/api/billing/create-portal-session'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${authTok}` },
      });
      const data = (await res.json()) as { url?: string; detail?: string };
      if (!res.ok || !data.url) {
        setMessage(typeof data.detail === 'string' ? data.detail : 'Portal no disponible');
        return;
      }
      window.location.href = data.url;
    } catch {
      setMessage('Error de conexión');
    } finally {
      setPortalLoading(false);
    }
  };

  const paymentsOn = Boolean(publicCfg?.payments_enabled);
  const showSubscribe = paymentsOn && status?.can_subscribe && !isAnonymous;
  const showPortal = paymentsOn && isPremium && status?.premium_source === 'stripe';

  return (
    <div className="min-h-[100dvh] bg-gray-950 text-white font-sans">
      <div className="max-w-lg mx-auto px-4 py-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6"
        >
          <ArrowLeft size={18} />
          Volver
        </button>

        <div className="flex items-center gap-3 mb-2">
          <Crown className="text-amber-400" size={32} />
          <h1 className="text-2xl font-bold">Albedrío Premium</h1>
        </div>
        <p className="text-gray-400 text-sm mb-6">
          Suscripción mensual. El importe se muestra en tu moneda en el checkout (Stripe Adaptive
          Pricing).
        </p>

        {loading ? (
          <p className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 size={18} className="animate-spin" />
            Cargando…
          </p>
        ) : (
          <>
            {isPremium && (
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
                <Sparkles size={16} className="inline mr-2 text-amber-400" />
                Tienes Premium activo
                {status?.premium_source === 'admin' && ' (regalo del administrador)'}
                {status?.premium_until && (
                  <span className="block text-xs text-amber-200/80 mt-1">
                    Válido hasta {new Date(status.premium_until).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}

            {!paymentsOn && (
              <p className="text-gray-500 text-sm mb-4">
                Los pagos están desactivados por el administrador.
              </p>
            )}

            {isAnonymous && paymentsOn && (
              <p className="text-amber-200/90 text-sm mb-4 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2">
                Para suscribirte necesitas una cuenta con Google o registro.{' '}
                <Link to="/login" className="underline text-amber-300">
                  Iniciar sesión
                </Link>
              </p>
            )}

            <ul className="text-sm text-gray-300 space-y-2 mb-6 list-disc pl-5">
              <li>Badge Premium visible en tu perfil</li>
              <li>Prioridad en mejoras y funciones exclusivas</li>
              <li>Cancela cuando quieras desde el portal de Stripe</li>
            </ul>

            {message && (
              <p className="text-sm text-cyan-200 mb-4 rounded-lg bg-cyan-950/30 border border-cyan-800/40 px-3 py-2">
                {message}
              </p>
            )}

            <div className="flex flex-col gap-3">
              {showSubscribe && (
                <button
                  type="button"
                  disabled={checkoutLoading}
                  onClick={() => void startCheckout()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 font-semibold text-white shadow-lg disabled:opacity-50"
                >
                  {checkoutLoading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <CreditCard size={20} />
                  )}
                  Suscribirme mensualmente
                </button>
              )}
              {showPortal && (
                <button
                  type="button"
                  disabled={portalLoading}
                  onClick={() => void openPortal()}
                  className="w-full rounded-xl border border-gray-600 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                >
                  {portalLoading ? 'Abriendo…' : 'Gestionar suscripción'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

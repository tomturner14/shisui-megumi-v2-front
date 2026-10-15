"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../page.module.scss";
type Action = "ACCEPTED" | "REJECTED" | "CANCELLED";
const names = { ACCEPTED: "承諾", REJECTED: "拒否", CANCELLED: "取消" };
export default function Actions({
  orderId,
  actions,
}: {
  orderId: string;
  actions: Action[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{
    action: Action;
    key: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState("");
  async function submit() {
    if (!pending || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/transition`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Admin-Action": "1" },
        body: JSON.stringify({
          toStatus: pending.action,
          operationKey: pending.key,
        }),
      });
      const result = await r.json();
      if (r.status >= 500) throw new Error("Unknown result");
      if (!r.ok) {
        setMessage(
          `操作できませんでした（${result.code}）。最新の状態を確認してください。`,
        );
        setPending(null);
        setUncertain(false);
        router.refresh();
        return;
      }
      setMessage(`操作を受け付けました。現在の状態：${result.status}`);
      setPending(null);
      setUncertain(false);
      router.refresh();
    } catch {
      setUncertain(true);
      setMessage(
        "通信結果が不明です。同じ操作キーで結果を再確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>注文操作</h2>
      <p>
        承諾は生産者への確認後に行ってください。拒否・取消では全SKUの確保在庫が解放されます。入金・引渡記録がある注文は取消できません。
      </p>
      <div className={styles.actions}>
        {actions.map((action) => (
          <button
            key={action}
            disabled={busy || pending !== null}
            onClick={() => {
              setPending({ action, key: crypto.randomUUID() });
              setMessage("");
            }}
          >
            {names[action]}
          </button>
        ))}
      </div>
      {pending && (
        <div className={styles.confirm}>
          <p>{names[pending.action]}を実行しますか？</p>
          <div className={styles.actions}>
            <button disabled={busy} onClick={submit}>
              {uncertain ? "同じ操作の結果を確認" : "確認して実行"}
            </button>
            {!uncertain && (
              <button disabled={busy} onClick={() => setPending(null)}>
                戻る
              </button>
            )}
          </div>
        </div>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

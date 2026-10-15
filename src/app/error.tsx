"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>現在、商品を表示できません</h1>
      <p>ローカルDBのmigration・seedを確認し、再試行してください。</p>
      <button onClick={reset}>再試行</button>
    </main>
  );
}

"use client";
import { useLayoutEffect, useRef } from "react";

/** 문서 모양 입력칸: 내용만큼 높이가 늘어나는 글 입력. need면 비었을 때 노란색, stale이면 확인 필요(주황) */
export default function Txt({ value, onChange, placeholder, need, stale }: { value: string; onChange: (v: string) => void; placeholder?: string; need?: boolean; stale?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, [value]);
  return <textarea ref={ref} rows={1} className={`dtxt${need && !value.trim() ? " need" : ""}${stale && value.trim() ? " stale" : ""}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloudSun, FileText } from "lucide-react";

const MENU = [
  { href: "/", label: "기후 리포트", icon: CloudSun },
  { href: "/budget", label: "세부사업설명서", icon: FileText },
];

export default function TopNav() {
  const path = usePathname();
  return (
    <nav className="topnav">
      <div className="topnav-inner">
        {MENU.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <Icon size={16} /> {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

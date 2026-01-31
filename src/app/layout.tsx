import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { WithAuth } from "@/middleware/WithAuth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "N2NJ.MOE", //
  description: "为22/7同好的转播站",
  icons: {
    icon: '/favicon.ico', // 确保您的新图标文件名为 favicon.ico 并替换 public 目录下的同名文件
    // 或者如果您使用的是 png 图标：
    // icon: '/icon.png', 
  },

};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <WithAuth>
            {children}
          </WithAuth>
        </ThemeProvider>
      </body>
    </html>
  );
}

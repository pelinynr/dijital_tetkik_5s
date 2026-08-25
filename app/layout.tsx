import type {Metadata} from "next"; import "./globals.css";
export const metadata:Metadata={title:"Erdemir | Tetkik Yönetim Sistemi",description:"Erdemir dijital tetkik ve uygunsuzluk yönetim portalı."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="tr"><body>{children}</body></html>}

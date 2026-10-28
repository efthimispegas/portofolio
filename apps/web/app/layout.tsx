import type {Metadata} from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import {AppProvider} from '../components/AppProvider';
import {Header,Footer} from '../components/Chrome';
import {BRAND} from '@mastoli/core';
export const metadata:Metadata={title:{default:`${BRAND} — Οι άνθρωποί σου. Μαζί σου.`,template:`%s · ${BRAND}`},description:'Το πορτοφόλι για τους επαγγελματίες της καθημερινότητάς σου. Μια κάρτα, όλες οι επαφές. Χωρίς λογαριασμό πελάτη.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="el"><body><AppProvider><a className="skip-link" href="#main">Μετάβαση στο περιεχόμενο / Skip to content</a><Header/>{children}<Footer/></AppProvider></body></html>}

'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {providerCardSchema,type ProviderCard,type Locale} from '@mastoli/core';
export interface SavedCard {card:ProviderCard;favorite:boolean;note:string;savedAt:string}
interface State {locale:Locale;setLocale:(l:Locale)=>void;t:(el:string,en:string)=>string;saved:SavedCard[];ready:boolean;storageError:string;save:(card:ProviderCard)=>void;remove:(slug:string)=>void;update:(slug:string,patch:Partial<Pick<SavedCard,'favorite'|'note'>>)=>void;clear:()=>void}
const Context=createContext<State|null>(null);
const KEY='portofolio.wallet.v1';
export function AppProvider({children}:{children:ReactNode}) {
  const [locale,setLocaleState]=useState<Locale>('el');const [saved,setSaved]=useState<SavedCard[]>([]);const [ready,setReady]=useState(false);const [storageError,setStorageError]=useState('');
  useEffect(()=>{try{setLocaleState(localStorage.getItem('portofolio.locale')==='en'?'en':'el');const raw=JSON.parse(localStorage.getItem(KEY)??'[]');if(Array.isArray(raw))setSaved(raw.filter((x):x is SavedCard=>Boolean(x)&&providerCardSchema.safeParse(x.card).success&&typeof x.favorite==='boolean'&&typeof x.note==='string'&&typeof x.savedAt==='string'));}catch{setStorageError('read');}setReady(true);},[]);
  useEffect(()=>{document.documentElement.lang=locale;},[locale]);
  useEffect(()=>{if(!ready)return;try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{setStorageError('write');}},[saved,ready]);
  function setLocale(l:Locale){setLocaleState(l);try{localStorage.setItem('portofolio.locale',l);}catch{setStorageError('write');}}
  const value:State={locale,setLocale,t:(el,en)=>locale==='el'?el:en,saved,ready,storageError,save:card=>setSaved(items=>{const existing=items.find(x=>x.card.slug===card.slug);return existing?items.map(x=>x.card.slug===card.slug?{...x,card}:x):[{card,favorite:false,note:'',savedAt:new Date().toISOString()},...items];}),remove:slug=>setSaved(items=>items.filter(x=>x.card.slug!==slug)),update:(slug,patch)=>setSaved(items=>items.map(x=>x.card.slug===slug?{...x,...patch}:x)),clear:()=>setSaved([])};
  return <Context.Provider value={value}>{children}{storageError&&<div className="storage-warning" role="alert">{value.t('Η αποθήκευση στον browser δεν είναι διαθέσιμη. Οι αλλαγές μπορεί να χαθούν όταν κλείσεις τη σελίδα.','Browser storage is unavailable. Changes may be lost when you close this page.')}</div>}</Context.Provider>;
}
export function useApp(){const value=useContext(Context);if(!value)throw new Error('AppProvider required');return value;}

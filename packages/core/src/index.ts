import { z } from 'zod';

export const BRAND = 'Portofolio';
export type Locale = 'el' | 'en';
export const categories = ['electrician','plumber','cooling','cleaning','gardening','care','teaching','beauty','professional'] as const;
export type Category = typeof categories[number];
export const routes = ['business','independent','household','employee','construction','occasional','other'] as const;
export type ProviderRoute = typeof routes[number];
export const categoryLabels: Record<Category, Record<Locale,string>> = {
  electrician:{el:'Ηλεκτρολόγος',en:'Electrician'},plumber:{el:'Υδραυλικός',en:'Plumber'},
  cooling:{el:'Ψύξη & θέρμανση',en:'Heating & cooling'},cleaning:{el:'Καθαρισμός',en:'Cleaning'},
  gardening:{el:'Κήπος',en:'Gardening'},care:{el:'Φροντίδα',en:'Care'},
  teaching:{el:'Μαθήματα',en:'Lessons'},beauty:{el:'Περιποίηση',en:'Beauty'},professional:{el:'Άλλος επαγγελματίας',en:'Other professional'}
};
export const routeLabels: Record<ProviderRoute,Record<Locale,string>> = {
  business:{el:'Επιχείρηση με ΓΕΜΗ',en:'GEMI-registered business'},
  independent:{el:'Ελεύθερος επαγγελματίας',en:'Independent professional'},
  household:{el:'Οικιακή εργασία με εργόσημο',en:'Household work with ergosimo'},
  employee:{el:'Εργαζόμενος σε επιχείρηση',en:'Employee / organization representative'},
  construction:{el:'Οικοδομική / τεχνική εργασία',en:'Construction / project worker'},
  occasional:{el:'Περιστασιακή δραστηριότητα',en:'Occasional activity'},
  other:{el:'Άλλη περίπτωση',en:'Another work arrangement'}
};
export const routeGuidance: Record<ProviderRoute,Record<Locale,string>> = {
  business:{el:'Στοιχεία ΑΑΔΕ και ΓΕΜΗ, εκπροσώπηση και τυχόν επαγγελματική άδεια.',en:'AADE and GEMI details, representation and any required professional credentials.'},
  independent:{el:'Τρέχουσα δραστηριότητα ΑΑΔΕ και στοιχεία επαγγέλματος. Το ΓΕΜΗ ζητείται όπου απαιτείται.',en:'Current AADE activity and professional evidence. GEMI is requested where applicable.'},
  household:{el:'Ελέγχουμε το είδος εργασίας και τη συγκεκριμένη σχέση απασχόλησης. Η ασφάλιση μόνη της δεν αρκεί.',en:'We review the exact service and work arrangement. Insurance alone is not sufficient.'},
  employee:{el:'Η κάρτα συνδέεται με την επιχείρηση που εκπροσωπείς και την εξουσιοδότησή της.',en:'Your card identifies the organization you represent and requires its authorization.'},
  construction:{el:'Ελέγχουμε την ιδιότητα εργαζομένου και το αντικείμενο εργασίας. Ο ΑΜΟΕ αφορά έργο, όχι επαγγελματική άδεια.',en:'We review your worker role and service scope. AMOE identifies a project, not a professional license.'},
  occasional:{el:'Η αίτηση εξετάζεται ειδικά. Ο τίτλος κτήσης δεν επιτρέπει αυτόματα συστηματική παροχή υπηρεσιών.',en:'This application needs specialist review. A title of acquisition does not automatically permit recurring services.'},
  other:{el:'Περιέγραψε τον τρόπο που εργάζεσαι. Θα ζητηθούν τα κατάλληλα στοιχεία για την περίπτωσή σου.',en:'Describe how you work. We will request evidence appropriate to your case.'}
};

export interface ProviderCard {
  id:string; slug:string; displayName:string; tagline:string; category:Category; area:string;
  description:string; phone:string; email:string; website:string;
  links:{label:string;url:string}[]; accent:string; initials:string;
  route:ProviderRoute; verificationLabel:string; updatedAt:string; isDemo:boolean;
  scope:string; services:string[];
}
export const providerCardSchema:z.ZodType<ProviderCard> = z.object({
  id:z.string().min(1).max(100),slug:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  displayName:z.string().min(2).max(100),tagline:z.string().max(160),category:z.enum(categories),
  area:z.string().max(100),description:z.string().max(1200),phone:z.string().max(24).refine(v=>v===''||/^\+?[0-9 ()-]{8,24}$/.test(v)),
  email:z.union([z.literal(''),z.email()]),website:z.string().max(300).refine(v=>v===''||isSafeWebUrl(v)),
  links:z.array(z.object({label:z.string().max(60),url:z.string().max(300).refine(isSafeWebUrl)})).max(12),
  accent:z.string().regex(/^#[0-9a-fA-F]{6}$/),initials:z.string().max(6),route:z.enum(routes),
  verificationLabel:z.string().max(160),updatedAt:z.iso.datetime({offset:true}),isDemo:z.boolean(),
  scope:z.string().max(600),services:z.array(z.string().max(120)).max(12)
}).strict();
export type ApplicationStatus = 'draft'|'submitted'|'needs_information'|'approved'|'rejected';

const text = (max:number) => z.string().trim().max(max);
export const applicationSchema = z.object({
  route:z.enum(routes),category:z.enum(categories),displayName:text(100).min(2),
  area:text(100).min(2),phone:text(24).regex(/^\+?[0-9 ()-]{8,24}$/,'Enter a valid phone number'),
  email:z.union([z.literal(''),z.email()]).default(''),website:text(300).default(''),
  instagramUrl:text(300).default(''),facebookUrl:text(300).default(''),linkedinUrl:text(300).default(''),
  description:text(1200).min(20),businessTaxId:text(9).default(''),gemiNumber:text(12).default(''),
  gemiApplicability:z.enum(['required','not_required','unknown']).default('unknown'),
  justification:text(1200).default(''),employerName:text(160).default(''),
  professionCredential:text(1200).default(''),declaration:z.boolean(),
  evidenceNotes:text(2000).default(''),serviceScope:text(600).min(5)
}).strict();
export type ApplicationInput = z.infer<typeof applicationSchema>;
export interface ProviderApplication extends ApplicationInput {
  id:string;ownerId:string;status:ApplicationStatus;createdAt:string;updatedAt:string;
  reviewReason?:string;cardSlug?:string;
}
export interface SessionUser {id:string;email:string;name:string;role:'provider'|'reviewer'}

export function isValidAfm(value:string):boolean {
  if(!/^\d{9}$/.test(value)||/^0+$/.test(value)) return false;
  let total=0;for(let i=0;i<8;i++)total+=Number(value[i])*2**(8-i);
  return (total%11)%10===Number(value[8]);
}
export function isSafeWebUrl(value:string):boolean {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&Boolean(u.hostname)&&!/[\r\n]/.test(value);}catch{return false;}
}
export function validateSubmission(input:ApplicationInput):{field:string;message:string}[] {
  const errors:{field:string;message:string}[]=[];
  const add=(field:string,message:string)=>errors.push({field,message});
  if(!input.declaration)add('declaration','Confirm the accuracy of your application.');
  for(const field of ['website','instagramUrl','facebookUrl','linkedinUrl'] as const) {
    if(input[field]&&!isSafeWebUrl(input[field]))add(field,'Use an HTTPS address without credentials.');
  }
  if(['business','independent'].includes(input.route)&&!isValidAfm(input.businessTaxId))add('businessTaxId','Provide a valid AFM. This checks its format only, not your activity.');
  if(input.route==='business'||input.gemiApplicability==='required') {
    if(!/^\d{12}$/.test(input.gemiNumber))add('gemiNumber','Provide the 12-digit GEMI number.');
  }
  if(input.route==='independent'&&input.gemiApplicability==='unknown')add('gemiApplicability','Select GEMI applicability or ask for help before submitting.');
  if(input.route==='independent'&&input.gemiApplicability==='not_required'&&input.justification.length<10)add('justification','Explain why GEMI does not apply; this will be reviewed.');
  if(input.route==='employee'&&input.employerName.length<2)add('employerName','Identify the organization you represent.');
  if(['electrician','plumber','cooling','teaching','beauty','care'].includes(input.category)&&input.professionCredential.length<10)add('professionCredential','Describe the relevant credential or exact activity for review.');
  if(['household','construction','occasional','other'].includes(input.route)&&input.justification.length<20)add('justification','Describe the specific work and engagement arrangement.');
  if(input.route==='household'&&['electrician','plumber','cooling'].includes(input.category))add('route','This regulated technical category requires a separately reviewed work route.');
  return errors;
}
export function requiresSpecialistReview(route:ProviderRoute):boolean {return ['household','construction','occasional','other'].includes(route);}

/** Accept only our profile links; never turn arbitrary QR text into a navigation action. */
export function parseCardLink(value:string,trustedOrigin:string):string|null {
  try {
    const url=new URL(value.trim());const trusted=new URL(trustedOrigin);
    if(url.username||url.password||url.search||url.hash||url.origin!==trusted.origin)return null;
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)))return null;
    const match=url.pathname.match(/^\/c\/([a-z0-9][a-z0-9-]{0,79})\/?$/);
    return match?.[1]??null;
  }catch{return null;}
}
export function cardUrl(slug:string,origin:string):string {return new URL(`/c/${encodeURIComponent(slug)}`,origin).toString();}

const sampleBase={phone:'',email:'',website:'',links:[],verificationLabel:'',updatedAt:'2026-10-26T09:00:00.000Z',isDemo:true,route:'independent' as const};
export const demoCards:ProviderCard[]=[
  {...sampleBase,id:'demo-nikos',slug:'nikos-water',displayName:'Νίκος Αντωνίου',tagline:'Μια λύση για κάθε διαρροή.',category:'plumber',area:'Παγκράτι · Αθήνα',description:'Ενδεικτική κάρτα υδραυλικού για να δοκιμάσεις το πορτοφόλι σου. Δεν αντιστοιχεί σε πραγματικό επαγγελματία.',accent:'#DCE8E4',initials:'ΝΑ',scope:'Demonstration only',services:['Υδραυλικές εγκαταστάσεις','Συντήρηση','Μικρές επισκευές']},
  {...sampleBase,id:'demo-elena',slug:'elena-home',displayName:'Έλενα Παππά',tagline:'Το σπίτι, όπως το θέλεις.',category:'cleaning',area:'Χολαργός · Αθήνα',description:'Ενδεικτική κάρτα υπηρεσιών καθαρισμού. Πρόσθεσέ τη για να δοκιμάσεις αναζήτηση, σημειώσεις και αγαπημένα.',accent:'#F3DBD0',initials:'ΕΠ',route:'household',scope:'Demonstration only',services:['Οικιακός καθαρισμός','Φροντίδα χώρου']},
  {...sampleBase,id:'demo-petros',slug:'petros-electric',displayName:'Πέτρος Γεωργίου',tagline:'Η σωστή επαφή, για το σπίτι.',category:'electrician',area:'Κυψέλη · Αθήνα',description:'Ενδεικτική κάρτα ηλεκτρολόγου. Τα στοιχεία είναι φανταστικά και δεν αποτελούν επαγγελματική σύσταση.',accent:'#DFE7F5',initials:'ΠΓ',scope:'Demonstration only',services:['Ηλεκτρολογικός έλεγχος','Φωτισμός','Εγκαταστάσεις']}
];
export const DEMO_CARDS=demoCards;
export const emptyApplication:ApplicationInput={route:'business',category:'plumber',displayName:'',area:'',phone:'',email:'',website:'',instagramUrl:'',facebookUrl:'',linkedinUrl:'',description:'',businessTaxId:'',gemiNumber:'',gemiApplicability:'required',justification:'',employerName:'',professionCredential:'',declaration:false,evidenceNotes:'',serviceScope:''};

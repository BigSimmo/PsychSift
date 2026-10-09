import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const THERAPY_CITATIONS = {
  "applied-relaxation-relaxation-based-therapy":
    "NICE Generalised anxiety disorder and panic disorder in adults guideline (CG113) recommends applied relaxation as an evidence-based psychological intervention for generalised anxiety disorder. RANZCP Clinical Practice Guidelines for the Management of Panic Disorder, Social Anxiety Disorder and Generalised Anxiety Disorder.",
  "behaviour-therapy":
    "NICE Clinical Guidelines on Depression in Adults (NG222) and Anxiety Disorders (CG113) endorse behavioural interventions and exposure therapy as established psychological treatments. RANZCP Psychotherapy Position Statement (PS #54).",
  "behavioural-activation-ba":
    "NICE Depression in adults: treatment and management guideline (NG222) recommends behavioural activation as a first-line psychological intervention for less severe and more severe depression. Cochrane Systematic Review: Behavioural activation therapy for depression in adults.",
  "behavioural-couples-therapy-for-substance-use-disorders-bct-sud":
    "NICE Alcohol-use disorders: diagnosis, assessment and management of harmful drinking and alcohol dependence (CG115) recommends behavioural couples therapy for people with alcohol problems who have a regular partner. Systematic review and meta-analysis of behavioural couples therapy for substance use disorders.",
  "carer-interventions":
    "NICE Psychosis and schizophrenia in adults: prevention and management guideline (CG178) recommends offering carer-focused education and support programmes to carers of people with psychosis or schizophrenia. NICE Bipolar disorder: assessment and management (CG185).",
  "cognitive-behavioural-therapy-cbt":
    "NICE Depression in adults guideline (NG222) and Generalised anxiety disorder guideline (CG113) recommend CBT as a first-line psychological intervention. RANZCP Position Statement #54: Psychotherapy conducted by psychiatrists.",
  "cognitive-behavioural-therapy-for-bipolar-depression-bipolar-relapse-prevention":
    "NICE Bipolar disorder: assessment and management guideline (CG185) recommends structured psychological interventions including cognitive behavioural therapy for bipolar depression and relapse prevention. RANZCP Clinical Practice Guidelines for Mood Disorders.",
  "cognitive-behavioural-therapy-for-insomnia-cbt-i":
    "Australasian Sleep Association / Sleep Health Foundation guidelines recommend CBT-I as the first-line treatment for chronic insomnia in adults. American Academy of Sleep Medicine (AASM) clinical practice guideline for the pharmacologic and non-pharmacologic treatment of chronic insomnia.",
  "cognitive-behavioural-therapy-for-psychosis-cbtp":
    "NICE Psychosis and schizophrenia in adults guideline (CG178) recommends cognitive behavioural therapy for psychosis (CBTp) for all people with psychosis or schizophrenia, across acute and recovery phases. RANZCP Australian and New Zealand clinical practice guidelines for the management of schizophrenia and related disorders.",
  "cognitive-therapy":
    "NICE Clinical Guidelines on Depression (NG222), Social Anxiety Disorder (CG159), and Post-Traumatic Stress Disorder (NG116) recommend cognitive therapy models within evidence-based psychotherapy pathways. Beck Institute for Cognitive Behavior Therapy core formulations.",
  "community-reinforcement-and-family-training-craft":
    "Substance Abuse and Mental Health Services Administration (SAMHSA) evidence-based treatment reviews for substance use disorders. National Institute on Drug Abuse (NIDA) principles of drug addiction treatment: Community Reinforcement Approach and CRAFT.",
  "contingency-management-cm":
    "NICE Drug misuse in over 16s: psychosocial interventions guideline (CG51) recommends contingency management to reduce illicit drug use and promote engagement for people in drug treatment programmes. NIDA principles of effective treatment.",
  "cue-exposure-therapy-cet-for-substance-use-disorders":
    "Systematic review and meta-analysis of cue exposure therapy in addiction and substance use disorders. World Health Organization (WHO) and NHMRC alcohol and substance intervention reviews.",
  "dialectical-behaviour-therapy-dbt":
    "NICE Borderline personality disorder: recognition and management guideline (CG78) recommends dialectical behaviour therapy (DBT) for women with borderline personality disorder for whom reducing recurrent self-harm is a priority. NHMRC Clinical Practice Guideline for the Management of Borderline Personality Disorder.",
  "exposure-and-response-prevention-for-tics-erp-for-tics":
    "European clinical guidelines for Tourette syndrome and other tic disorders: behavioural and psychosocial interventions (ERP and HRT/CBIT). American Academy of Neurology (AAN) practice guideline recommendations on the treatment of tics in people with Tourette syndrome and chronic tic disorders.",
  "family-intervention-for-psychosis":
    "NICE Psychosis and schizophrenia in adults guideline (CG178) recommends family intervention for all families of people with psychosis or schizophrenia who live with or are in close contact with the service user. RANZCP clinical practice guidelines for schizophrenia.",
  "family-psychoeducation-for-psychosis":
    "NICE Psychosis and schizophrenia in adults guideline (CG178) and quality standards (QS80) recommend psychoeducation and family-focused support for relatives and carers of individuals with psychosis. Cochrane Review: Psychoeducation for schizophrenia.",
  "family-focused-psychoeducation-for-bipolar-disorder":
    "NICE Bipolar disorder: assessment and management guideline (CG185) recommends offering family intervention and psychoeducation to people with bipolar disorder and their families/carers. RANZCP Mood Disorders Clinical Practice Guidelines.",
  "group-psychoeducation-for-bipolar-disorder":
    "NICE Bipolar disorder: assessment and management guideline (CG185) recommends structured group psychoeducation for maintenance and relapse prevention in adults with bipolar disorder. Colom and Vieta Barcelona Psychoeducation Program randomized controlled trials.",
  "habit-reversal-training-for-trichotillomania-and-excoriation-disorder":
    "American Psychiatric Association (APA) and European guidelines for body-focused repetitive behaviours recommend habit reversal training (HRT) and comprehensive behavioural intervention (CBIT) as primary treatments for trichotillomania and excoriation disorder. TLC Foundation for Body-Focused Repetitive Behaviors clinical practice guidelines.",
  "imagery-rehearsal-therapy-irt-for-nightmare-disorder":
    "American Academy of Sleep Medicine (AASM) Best Practice Guide for the Treatment of Nightmare Disorder in Adults recommends Imagery Rehearsal Therapy (IRT) as a primary psychological treatment for post-traumatic and idiopathic nightmares.",
  "integrated-cbt-for-ptsd-and-substance-use-disorders":
    "VA/DoD Clinical Practice Guideline for the Management of Posttraumatic Stress Disorder and Acute Stress Disorder recommends concurrent or integrated evidence-based psychological treatment for co-occurring PTSD and substance use disorder. Phoenix Australia Australian Guidelines for the Prevention and Treatment of Acute Stress Disorder and PTSD.",
  "interpersonal-and-social-rhythm-therapy-ipsrt":
    "NICE Bipolar disorder guideline (CG185) recommends structured psychological interventions designed specifically for bipolar disorder with evidence-based manuals. Frank et al. randomized trials of Interpersonal and Social Rhythm Therapy (IPSRT) in maintenance and acute bipolar disorder.",
  "matrix-model":
    "SAMHSA Treatment Improvement Protocol (TIP 33): Treatment for Stimulant Use Disorders. NIDA principles of drug addiction treatment: The Matrix Model for outpatient methamphetamine and cocaine treatment.",
  "mentalisation-based-therapy-mbt":
    "NHMRC Clinical Practice Guideline for the Management of Borderline Personality Disorder recognises Mentalisation-Based Treatment (MBT) as an effective specialised psychotherapy. Bateman and Fonagy randomized controlled trials and Cochrane reviews of psychological therapies for BPD.",
  "mindfulness-based-relapse-prevention-mbrp":
    "Bowen et al. randomized controlled trials of Mindfulness-Based Relapse Prevention for substance use disorders. Systematic reviews and meta-analyses of mindfulness-based interventions in substance misuse and craving regulation.",
  "mindfulness-based-therapy-for-insomnia-mbti":
    "Ong et al. Mindfulness-Based Therapy for Insomnia (MBTI) clinical trial series and sleep medicine reviews. Australasian Sleep Association clinical recommendations on psychological approaches to chronic insomnia.",
  "mother-infant-therapy-mother-infant-psychotherapy":
    "NICE Antenatal and postnatal mental health: clinical management and service guidance (CG192) recommends psychological and parent-infant interventions to improve maternal mental health and mother-infant relationship. Australian National Perinatal Mental Health Guideline (COPE).",
  "motivational-enhancement-therapy-met":
    "NIDA Principles of Drug Addiction Treatment and Project MATCH research group clinical trial outcomes. SAMHSA TIP 35: Enhancing Motivation for Change in Substance Use Disorder Treatment.",
  "motivational-interviewing-mi-for-substance-use-disorders":
    "NICE Alcohol-use disorders: diagnosis, assessment and management of harmful drinking and alcohol dependence (CG115) recommends motivational interventions. SAMHSA Treatment Improvement Protocol 35 (TIP 35): Enhancing Motivation for Change in Substance Use Disorder Treatment. Miller and Rollnick foundational clinical practice texts.",
  "multi-family-interventions":
    "NICE Psychosis and schizophrenia in adults guideline (CG178) recommends family intervention delivered as either single-family or multi-family group sessions based on consumer and family preference. McFarlane multi-family groups in schizophrenia.",
  "parent-management-training-pmt":
    "NICE Antisocial behaviour and conduct disorders in children and young people: recognition and management guideline (CG158) recommends parent training programmes based on social learning principles for conduct problems. Kazdin parent management training evidence base.",
  "parent-training":
    "NICE Antisocial behaviour and conduct disorders in children and young people guideline (CG158) recommends group parent training programmes for parents of children aged 3 to 11 years with or at high risk of conduct disorder. Cochrane Review: Parent training programmes for conduct problems in young children.",
  "parent-and-child-training":
    "NICE Antisocial behaviour and conduct disorders in children and young people guideline (CG158) recommends child and parent-focused programmes for severe conduct and behavioural problems. Australian guidelines for child behavioural interventions.",
  "parent-child-relational-therapy":
    "NICE Antenatal and postnatal mental health guideline (CG192) and Clinical Guidelines for Early Childhood Mental Health endorse relational parent-child therapies for attachment difficulties and relationship distress. Zero to Three: Diagnostic Classification of Mental Health and Developmental Disorders of Infancy and Early Childhood (DC:0-5).",
  "parent-child-interaction-therapy-pcit":
    "Eyberg et al. Parent-Child Interaction Therapy evidence base. Systematic reviews and meta-analyses of PCIT for externalizing and disruptive behaviours in young children. California Evidence-Based Clearinghouse for Child Welfare (CEBC) rating for PCIT.",
  "peer-support":
    "NICE Rehabilitation for adults with complex psychosis and related severe mental illness guideline (NG181) recommends peer support and peer support workers in multidisciplinary mental health rehabilitation teams. National Mental Health Commission (Australia) peer workforce guidelines.",
  "problem-solving-therapy-pst":
    "NICE Depression in adults: treatment and management guideline (NG222) recognises problem-solving therapy as an evidence-based low- or high-intensity psychological intervention. Systematic review and meta-analysis of problem-solving therapy for depression in primary care.",
  "psychoeducation-for-psychosis":
    "NICE Psychosis and schizophrenia in adults guideline (CG178) and quality standards (QS80) recommend illness education, relapse prevention planning, and self-management support for people with psychosis. Cochrane Review: Psychoeducation for schizophrenia.",
  "recovery-oriented-psychosocial-interventions":
    "NICE Rehabilitation for adults with complex psychosis and related severe mental illness guideline (NG181) recommends recovery-orientated rehabilitation services promoting personal autonomy, meaningful activity, and social inclusion. National Framework for Recovery-Oriented Mental Health Services (Australian Government Department of Health).",
  "relapse-prevention-therapy-for-substance-use-disorders":
    "NICE Alcohol-use disorders: diagnosis, assessment and management guideline (CG115) and Drug misuse guideline (CG51) recommend cognitive-behavioural relapse prevention therapies. Marlatt and Gordon relapse prevention model.",
  "relapse-prevention-psychotherapy":
    "NICE Depression in adults guideline (NG222) recommends psychological interventions focused on relapse prevention (including maintenance CBT and MBCT) for individuals with recurrent depression. RANZCP Clinical Practice Guidelines for Mood Disorders.",
  "seeking-safety":
    "Najavits Seeking Safety manual and clinical outcome trials for co-occurring PTSD and substance abuse. SAMHSA National Registry of Evidence-based Programs and Practices (NREPP) review for Seeking Safety.",
  "short-term-psychodynamic-psychotherapy-for-depression-stpp":
    "NICE Depression in adults guideline (NG222) lists short-term psychodynamic psychotherapy (STPP) as a recommended treatment option for depression. Cochrane Systematic Review: Short-term psychodynamic psychotherapies for common mental disorders.",
  "social-communication-parent-mediated-autism-interventions":
    "NICE Autism spectrum disorder in under 19s: support and management guideline (CG170) recommends parent- or carer-mediated social communication interventions for children and young people with autism. Cochrane Review: Parent-mediated early intervention for young children with autism spectrum disorders.",
  "supportive-expressive-psychodynamic-counselling-approaches-for-depression":
    "NICE Depression in adults guideline (NG222) recognises supportive and psychodynamic counselling approaches within stepped care options. Luborsky supportive-expressive psychotherapy clinical research series.",
  "twelve-step-facilitation-tsf":
    "Cochrane Systematic Review: Alcoholics Anonymous and other 12-step programs for alcohol use disorder (Kelly et al., 2020) found manualized AA/TSF interventions as effective as other established treatments and superior for continuous abstinence. Project MATCH 12-step facilitation therapy manual (NIAAA).",
};

const sourcePath = join(process.cwd(), "src/data/therapies-source.json");
const therapies = JSON.parse(readFileSync(sourcePath, "utf8"));

let patchedCount = 0;
for (const therapy of therapies) {
  if (THERAPY_CITATIONS[therapy.slug]) {
    const citation = THERAPY_CITATIONS[therapy.slug];
    therapy.references = citation;
    if (Array.isArray(therapy.sources) && therapy.sources.length > 0) {
      therapy.sources[0].reference = citation;
    }
    patchedCount++;
  }
}

console.log(`Patched ${patchedCount} therapies with references.`);
if (patchedCount !== 47) {
  throw new Error(`Expected 47 therapies patched, but patched ${patchedCount}`);
}

writeFileSync(sourcePath, JSON.stringify(therapies, null, 2) + "\n", "utf8");
console.log("Updated src/data/therapies-source.json successfully.");

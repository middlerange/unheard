export type ResearchSourceSeed = {
  id: string;
  name: string;
  url: string;
  feedUrl?: string;
  kind: 'rss' | 'web' | 'youtube' | 'community';
  category: 'practitioner' | 'research' | 'competitor' | 'community' | 'youtube';
  author?: string;
  enabled: boolean;
  notes: string;
  priority: 1 | 2 | 3;
  channelId?: string;
};

// Preserve the 43 mapped sources so teams can opt back in to market monitoring.
// Default collection favors public practitioner writing, interviews, and original research.
export const RESEARCH_SOURCE_SEEDS: ResearchSourceSeed[] = [
  {
    "id": "original-lennys-archive",
    "name": "Lenny’s archive",
    "url": "https://www.lennysnewsletter.com/archive",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "notes": "Activation case studies, growth experiments, onboarding, AI product work. Public archive; individual posts may be paid. Homepage returns subscription wall. Public RSS fetched 23 October 2026; paid post excerpts are not full evidence.",
    "priority": 1,
    "feedUrl": "https://www.lennysnewsletter.com/feed",
    "author": "Lenny Rachitsky"
  },
  {
    "id": "original-growth-unhinged-archive",
    "name": "Growth Unhinged archive",
    "url": "https://www.growthunhinged.com/archive",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "notes": "PLG conversion, expansion, pricing, B2B benchmarks, AI GTM. Public beehiiv archive; paginate. Some premium material. Public dated archive verified 23 October 2026; feed was blocked, so use index discovery.",
    "priority": 1,
    "author": "Kyle Poyar"
  },
  {
    "id": "original-elenas-growth-scoop-archive",
    "name": "Elena’s Growth Scoop archive",
    "url": "https://www.elenaverna.com/archive",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "notes": "Growth loops, retention, experimentation, AI effects on SaaS. Public archive; individual post access varies. Homepage subscription wall. Public RSS fetched 23 October 2026; paid post excerpts are not full evidence.",
    "priority": 1,
    "feedUrl": "https://www.elenaverna.com/feed",
    "author": "Elena Verna"
  },
  {
    "id": "original-reforge-blog",
    "name": "Reforge blog",
    "url": "https://www.reforge.com/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Growth systems, product strategy, AI workflows and research. Public blog; courses and member resources separate.",
    "priority": 2
  },
  {
    "id": "original-productled-blog",
    "name": "ProductLed blog",
    "url": "https://productled.com/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Time to value, onboarding, free-to-paid conversion, PLG operations. Public library with topic filters and dates.",
    "priority": 1
  },
  {
    "id": "original-pma-content-hub",
    "name": "PMA content hub",
    "url": "https://www.productmarketingalliance.com/content-hub/",
    "kind": "rss",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Feature launches, adoption, positioning, customer research. Public and member content mixed.",
    "priority": 1,
    "feedUrl": "https://www.productmarketingalliance.com/rss/"
  },
  {
    "id": "original-mind-the-product",
    "name": "Mind the Product",
    "url": "https://www.mindtheproduct.com/",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Product discovery, strategy, feedback, PM case studies. Public articles and weekly newsletter; filter career and event noise.",
    "priority": 1
  },
  {
    "id": "original-demand-curve-newsletter",
    "name": "Demand Curve newsletter",
    "url": "https://www.demandcurve.com/newsletter",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Lifecycle campaigns, conversion and growth experiments. Public archive; broader than ICP, use topic filter.",
    "priority": 2
  },
  {
    "id": "original-amplitude-blog",
    "name": "Amplitude blog",
    "url": "https://amplitude.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Activation, retention, product benchmarks, analytics, guides, AI. Public; filter B2B SaaS, benchmarks, guides, adoption and AI.",
    "priority": 1
  },
  {
    "id": "original-mixpanel-blog",
    "name": "Mixpanel blog",
    "url": "https://mixpanel.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Retention analysis, instrumentation, experimentation, AI analytics. Public; distinguish research and customer examples from promotional posts.",
    "priority": 2
  },
  {
    "id": "original-pendo-blog",
    "name": "Pendo blog",
    "url": "https://www.pendo.io/pendo-blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. In-app guidance, adoption measurement, feedback and agent context. Public; close workflow overlap with Userorbit.",
    "priority": 1
  },
  {
    "id": "original-chartmogul-blog",
    "name": "ChartMogul blog",
    "url": "https://chartmogul.com/blog/",
    "kind": "web",
    "category": "research",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. SaaS retention, expansion, PLG benchmarks and activation. Public; outcomes and metrics lens.",
    "priority": 1
  },
  {
    "id": "original-churnzero-blog",
    "name": "ChurnZero blog",
    "url": "https://churnzero.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Churn, NRR, digital customer success, onboarding, CS research. Public summaries; some report downloads may be gated.",
    "priority": 1
  },
  {
    "id": "original-intercom-blog",
    "name": "Intercom blog",
    "url": "https://www.intercom.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. AI support, help centers, customer communication, user trust research. Public; self-service and AI knowledge workflows.",
    "priority": 2
  },
  {
    "id": "original-zendesk-blog",
    "name": "Zendesk blog",
    "url": "https://www.zendesk.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. AI service, knowledge management, customer experience research. Public; filter enterprise service and HR noise.",
    "priority": 2
  },
  {
    "id": "original-gainsight-blog",
    "name": "Gainsight blog",
    "url": "https://www.gainsight.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Product adoption, education, tech-touch CS, retention. Public; paginate and verify individual dates.",
    "priority": 2
  },
  {
    "id": "original-document360-blog",
    "name": "Document360 blog",
    "url": "https://document360.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Help docs, AI documentation QA, knowledge-base maintenance. Public; filter technical documentation, customer support and AI.",
    "priority": 2
  },
  {
    "id": "original-appcues-blog",
    "name": "Appcues blog",
    "url": "https://www.appcues.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Onboarding, activation experiments, lifecycle engagement, AI creation. Public; prioritize experiments and original examples over tool listicles.",
    "priority": 2
  },
  {
    "id": "original-userpilot-blog",
    "name": "Userpilot blog",
    "url": "https://userpilot.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Onboarding, feature adoption, activation and product analytics. Public; high SEO volume requires originality filter.",
    "priority": 2
  },
  {
    "id": "original-userguiding-blog",
    "name": "UserGuiding blog",
    "url": "https://userguiding.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Product guidance, adoption, AI assistants and analytics. Public; prioritize changes and research over comparisons.",
    "priority": 2
  },
  {
    "id": "original-chameleon-blog",
    "name": "Chameleon blog",
    "url": "https://www.chameleon.io/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Feature discovery, contextual onboarding, personalization, friction. Public; weekly newsletter advertised.",
    "priority": 2
  },
  {
    "id": "original-productboard-blog",
    "name": "Productboard blog",
    "url": "https://www.productboard.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Feedback analysis, customer context, prioritization, AI product workflows. Public; strong feedback workflow relevance.",
    "priority": 2
  },
  {
    "id": "original-announcekit-blog",
    "name": "AnnounceKit blog",
    "url": "https://announcekit.app/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Release communication, changelog automation, feature awareness. Public; narrow topical fit.",
    "priority": 2
  },
  {
    "id": "original-appcues-changelog",
    "name": "Appcues changelog",
    "url": "https://feedback.appcues.com/changelog",
    "kind": "rss",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. AI flow creation, surveys, targeting, branching, MCP. Public dated releases.",
    "priority": 1,
    "feedUrl": "https://feedback.appcues.com/api/changelog/feed.rss"
  },
  {
    "id": "original-canny-changelog",
    "name": "Canny changelog",
    "url": "https://feedback.canny.io/changelog",
    "kind": "rss",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Feedback capture, segmentation, prioritization, AI integrations. Public releases.",
    "priority": 1,
    "feedUrl": "https://feedback.canny.io/api/changelog/feed.rss"
  },
  {
    "id": "original-userguiding-product-updates",
    "name": "UserGuiding product updates",
    "url": "https://updates.userguiding.com/en",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Guidance, AI assistants, feedback and analytics changes. Public update page; inspect individual dates.",
    "priority": 2
  },
  {
    "id": "original-announcekit-product-updates",
    "name": "AnnounceKit product updates",
    "url": "https://changelog.announcekit.app/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Changelog publishing, notifications, MCP, help-center expansion. Public; validate individual launch dates.",
    "priority": 2
  },
  {
    "id": "original-amplitude-releases",
    "name": "Amplitude releases",
    "url": "https://amplitude.com/releases",
    "kind": "rss",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Guides and surveys, targeting, experiments and analytics changes. Public dated entries; Markdown also advertised at https://amplitude.com/releases.md.",
    "priority": 1,
    "feedUrl": "https://amplitude.com/releases/feed.xml"
  },
  {
    "id": "original-mixpanel-changelogs",
    "name": "Mixpanel changelogs",
    "url": "https://docs.mixpanel.com/changelogs",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Measurement, experimentation, replay and AI capabilities. Public dated changelog; /releases/ redirects here.",
    "priority": 2
  },
  {
    "id": "original-intercom-changes",
    "name": "Intercom changes",
    "url": "https://www.intercom.com/changes/en",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Fin, help center, messaging and support workflow releases. Public dated changelog; pagination needed.",
    "priority": 1
  },
  {
    "id": "original-whats-new-in-pendo",
    "name": "What’s new in Pendo",
    "url": "https://www.pendo.io/new/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Adoption, analytics, guides, agent context and measurement. Public overview; follow full release notes to validate dates and details.",
    "priority": 2
  },
  {
    "id": "original-lennys-community",
    "name": "Lenny’s community",
    "url": "https://www.lennysnewsletter.com/p/community/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Practitioner questions, experiments, objections. Paid-subscriber Slack; only public landing page fetched. Discussions require authorized access.",
    "priority": 3
  },
  {
    "id": "original-productled-community",
    "name": "ProductLed community",
    "url": "https://productled.com/community",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. PLG problems, onboarding experiments, operator questions. Free-to-join Slack; only public landing page fetched. Discussions require membership and authorization.",
    "priority": 3
  },
  {
    "id": "original-pma-slack-community",
    "name": "PMA Slack community",
    "url": "https://www.productmarketingalliance.com/join-the-pma-slack-community/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Launch and adoption problems, PMM questions, workflows. Join-required Slack; only public landing page fetched. Not public bulk-scanning target.",
    "priority": 3
  },
  {
    "id": "original-pendo-community",
    "name": "Pendo community",
    "url": "https://community.pendo.io/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Adoption events, implementation questions, peer practice. Public events and content plus Pendo Connect Slack; private discussions require authorized access.",
    "priority": 3
  },
  {
    "id": "original-producttank",
    "name": "ProductTank",
    "url": "https://www.mindtheproduct.com/producttank/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Practitioner talks and emerging product problems. Public meetup directory; free events, recordings vary.",
    "priority": 3
  },
  {
    "id": "original-thought-industries-blog",
    "name": "Thought Industries blog",
    "url": "https://www.thoughtindustries.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Customer education, knowledge governance, stale content, AI guidance. Public blog and announcements; follow news links as the blog listing can lag launches.",
    "priority": 1
  },
  {
    "id": "original-r-productmanagement",
    "name": "r/ProductManagement",
    "url": "https://www.reddit.com/r/ProductManagement/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Product discovery, adoption friction, AI pressure; exclude career and employee onboarding threads. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-r-productmarketing",
    "name": "r/ProductMarketing",
    "url": "https://www.reddit.com/r/ProductMarketing/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Launch communication, feature awareness, positioning, adoption measurement. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-r-saas",
    "name": "r/SaaS",
    "url": "https://www.reddit.com/r/SaaS/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Activation and retention experiments; remove self-promotion. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-r-customersuccess",
    "name": "r/CustomerSuccess",
    "url": "https://www.reddit.com/r/CustomerSuccess/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Customer onboarding, churn, education, knowledge gaps. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-hacker-news",
    "name": "Hacker News",
    "url": "https://news.ycombinator.com/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. First-person product lessons and relevant SaaS customer workflows. Public search returned 23 candidates; high technical and general-business noise. Follow linked primary pages.",
    "priority": 3
  },
  {
    "id": "original-github-public-issues-and-releases",
    "name": "GitHub public issues and releases",
    "url": "https://github.com/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Changes to integrations and AI-assisted customer workflows; scope future runs to named repos. Engine returned 14 candidates using available gh access. Open PRs are proposals, not shipped features.",
    "priority": 3
  },
  {
    "id": "teresa-torres-product-talk",
    "name": "Product Talk",
    "url": "https://www.producttalk.org/",
    "feedUrl": "https://www.producttalk.org/rss/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Teresa Torres",
    "enabled": true,
    "notes": "Continuous discovery, customer interviews, assumption testing, and evidence from product teams. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "marty-cagan-svpg",
    "name": "Silicon Valley Product Group",
    "url": "https://www.svpg.com/articles/",
    "feedUrl": "https://www.svpg.com/feed/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Marty Cagan and SVPG partners",
    "enabled": true,
    "notes": "Product strategy, product operating model, discovery, and product marketing; ignore workshop promotions. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "julie-zhuo-looking-glass",
    "name": "The Looking Glass",
    "url": "https://lg.substack.com/",
    "feedUrl": "https://lg.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Julie Zhuo",
    "enabled": true,
    "notes": "First-person product building, design judgment, and product leadership; exclude general career advice. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "gibson-biddle-ask-gib",
    "name": "Ask Gib",
    "url": "https://askgib.substack.com/",
    "feedUrl": "https://askgib.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Gibson Biddle",
    "enabled": true,
    "notes": "Product strategy, retention, experiments, and lessons from Netflix and Chegg. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "melissa-perri",
    "name": "Melissa Perri",
    "url": "https://melissaperri.com/blog",
    "feedUrl": "https://melissaperri.com/blog?format=rss",
    "kind": "rss",
    "category": "practitioner",
    "author": "Melissa Perri",
    "enabled": true,
    "notes": "Product strategy, product operations, and outcomes. Low publishing frequency; newest blog entry observed was from 2024. Do not present stale work as new news. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "john-cutler-beautiful-mess",
    "name": "The Beautiful Mess",
    "url": "https://cutlefish.substack.com/",
    "feedUrl": "https://cutlefish.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "John Cutler",
    "enabled": true,
    "notes": "Product decisions, feedback systems, evidence, team habits, and outcomes. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "aakash-gupta-product-growth",
    "name": "Product Growth",
    "url": "https://www.news.aakashg.com/",
    "feedUrl": "https://www.news.aakashg.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Aakash Gupta",
    "enabled": true,
    "notes": "Product growth deep dives, AI product workflows, and practitioner interviews; reject job-search content and promotional posts. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "brian-balfour",
    "name": "Brian Balfour",
    "url": "https://blog.brianbalfour.com/",
    "feedUrl": "https://blog.brianbalfour.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Brian Balfour",
    "enabled": true,
    "notes": "Growth systems, distribution shifts, AI product strategy, and first-hand experiments. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "casey-winters-accidental",
    "name": "Casey Accidental",
    "url": "https://www.caseyaccidental.com/",
    "feedUrl": "https://www.caseyaccidental.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Casey Winters",
    "enabled": true,
    "notes": "Retention, scaling products, growth loops, and marketplace lessons; prioritize B2B applicability. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "april-dunford-positioning",
    "name": "Positioning with April Dunford",
    "url": "https://aprildunford.substack.com/",
    "feedUrl": "https://aprildunford.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "April Dunford",
    "enabled": true,
    "notes": "B2B positioning, customer value, sales conversations, and product marketing. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "ken-norton-bring-donuts",
    "name": "Bring the Donuts",
    "url": "https://www.bringthedonuts.com/blog/",
    "feedUrl": "https://www.bringthedonuts.com/feed.xml",
    "kind": "rss",
    "category": "practitioner",
    "author": "Ken Norton",
    "enabled": true,
    "notes": "Product craft and decision-making; filter personal coaching and general career content. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "sachin-rekhi",
    "name": "Sachin Rekhi",
    "url": "https://www.sachinrekhi.com/",
    "feedUrl": "https://www.sachinrekhi.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Sachin Rekhi",
    "enabled": true,
    "notes": "Product craft, AI workflows, product strategy, and first-person startup lessons. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "wes-kao",
    "name": "Wes Kao’s Newsletter",
    "url": "https://newsletter.weskao.com/",
    "feedUrl": "https://newsletter.weskao.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Wes Kao",
    "enabled": true,
    "notes": "Communication, customer understanding, and practical leadership; retain only direct product or PMM relevance. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "shreyas-doshi",
    "name": "Shreyas Free Newsletter",
    "url": "https://shreyasdoshi.substack.com/",
    "feedUrl": "https://shreyasdoshi.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Shreyas Doshi",
    "enabled": true,
    "notes": "Product judgment, customer value, product strategy, and product leadership. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "itamar-gilad",
    "name": "Itamar Gilad",
    "url": "https://itamargilad.com/",
    "feedUrl": "https://itamargilad.com/feed/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Itamar Gilad",
    "enabled": true,
    "notes": "Evidence-guided product decisions, experiments, discovery, and outcome measurement. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "lennys-podcast-youtube",
    "name": "Lenny’s Podcast",
    "url": "https://www.youtube.com/channel/UC6t1O76G0jYXOAoYCm153dA",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UC6t1O76G0jYXOAoYCm153dA",
    "kind": "youtube",
    "category": "youtube",
    "author": "Lenny Rachitsky",
    "enabled": true,
    "notes": "Long-form product and growth interviews. Many clips and Shorts; deduplicate against newsletter episodes and prefer full interviews. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UC6t1O76G0jYXOAoYCm153dA"
  },
  {
    "id": "mind-product-youtube",
    "name": "Mind the Product — talks and interviews",
    "url": "https://www.youtube.com/channel/UCiT1BmYvOBsEvU9iw0076Sw",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCiT1BmYvOBsEvU9iw0076Sw",
    "kind": "youtube",
    "category": "youtube",
    "author": "Mind the Product",
    "enabled": true,
    "notes": "Practitioner talks and interviews on product discovery, strategy, and customer value; filter event promotions and career topics. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCiT1BmYvOBsEvU9iw0076Sw"
  },
  {
    "id": "product-talk-youtube",
    "name": "Product Talk — videos",
    "url": "https://www.youtube.com/channel/UCOeQvCDAioiHfcbYnyO99MQ",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCOeQvCDAioiHfcbYnyO99MQ",
    "kind": "youtube",
    "category": "youtube",
    "author": "Teresa Torres",
    "enabled": true,
    "notes": "Continuous discovery and practical product interviews, including Just Now Possible. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCOeQvCDAioiHfcbYnyO99MQ"
  },
  {
    "id": "melissa-perri-youtube",
    "name": "Product Thinking — Melissa Perri",
    "url": "https://www.youtube.com/channel/UCXs8MCXAX2GIOAzhBCOQP0w",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCXs8MCXAX2GIOAzhBCOQP0w",
    "kind": "youtube",
    "category": "youtube",
    "author": "Melissa Perri",
    "enabled": true,
    "notes": "Product leadership interviews and product strategy. Distinguish original published date from feed updated date. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCXs8MCXAX2GIOAzhBCOQP0w"
  },
  {
    "id": "april-dunford-youtube",
    "name": "April Dunford — Positioning",
    "url": "https://www.youtube.com/channel/UCucNuc_Myj4xCQN7gUXhH-g",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCucNuc_Myj4xCQN7gUXhH-g",
    "kind": "youtube",
    "category": "youtube",
    "author": "April Dunford",
    "enabled": true,
    "notes": "B2B positioning and product marketing advice, with practitioner examples. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCucNuc_Myj4xCQN7gUXhH-g"
  },
  {
    "id": "saas-capital-research",
    "name": "SaaS Capital — original research",
    "url": "https://www.saas-capital.com/research/",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "notes": "Public research index verified 23 October 2026. Original private B2B SaaS growth, retention, pricing, and capital efficiency benchmarks. Follow dated research pages; report sample, survey period, and methodology. Skip finance-only content, gated downloads, and undated indexes.",
    "priority": 1
  },
  {
    "id": "benchmarkit-research",
    "name": "Benchmarkit — research reports",
    "url": "https://www.benchmarkit.ai/research-reports",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "notes": "Public report index verified 23 October 2026. Original B2B SaaS and product-growth benchmarks; sponsored research requires method and sample scrutiny. Follow public dated reports; skip gated downloads and undated interactive dashboards.",
    "priority": 2
  }
];

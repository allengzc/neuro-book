import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: process.env.PAGES_BASE_PATH ?? '/',
  title: "NeuroBook",
  description: "NeuroBook：面向长篇小说创作的本地 AI 工作台。",
  srcExclude: [
    'README.md',
    'archived/**',
    'drafts/**',
    'modules/**',
    'operator-bridge.md',
    'research/**',
    'tasks/**'
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/quick-start' },
      { text: '教程', link: '/tutorials/' },
      { text: '部署', link: '/deployment' },
      { text: '理念', link: '/blog-agent-rp-harness' },
      { text: 'Agent', link: '/agent/' },
      { text: 'Profile', link: '/profile/' },
      { text: 'Reference', link: 'https://github.com/notnotype/neuro-book/blob/master/reference/README.md' },
      { text: 'GitHub', link: 'https://github.com/notnotype/neuro-book' }
    ],

    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '介绍', link: '/introduction' },
          { text: '快速开始', link: '/quick-start' },
          { text: '部署方式', link: '/deployment' }
        ]
      },
      {
        text: '基础教程',
        items: [
          { text: '总览', link: '/tutorials/' },
          { text: '开始前检查', link: '/tutorials/00-before-you-start' },
          { text: '认识工作台', link: '/tutorials/01-studio-tour' },
          { text: '创建第一本书', link: '/tutorials/02-first-project' },
          { text: '用 Skill 点燃故事', link: '/tutorials/03-skills-bootstrap' },
          { text: '写出前三章', link: '/tutorials/04-first-three-chapters' },
          { text: '导入角色卡', link: '/tutorials/05-import-character-card' },
          { text: '进入世界模拟', link: '/tutorials/06-enter-world-simulation' }
        ]
      },
      {
        text: 'Agent',
        items: [
          { text: 'Agent 心智模型', link: '/agent/' },
          { text: '工具', link: '/agent/tools' },
          { text: 'Sidecar', link: '/agent/sidecar' },
          { text: 'Agent Harness', link: '/agent/advanced' }
        ]
      },
      {
        text: 'Profile',
        items: [
          { text: 'Profile 介绍', link: '/profile/' },
          { text: 'Leader', link: '/profile/leader' },
          { text: 'Writer', link: '/profile/writer' },
          { text: '其他 Profile', link: '/profile/other-profiles' }
        ]
      },
      {
        text: 'Profile TSX',
        items: [
          { text: 'Profile TSX 介绍', link: '/profile-tsx/' },
          { text: '节点说明', link: '/profile-tsx/nodes' },
          { text: '示例', link: '/profile-tsx/examples' }
        ]
      },
      {
        text: '设计文章',
        items: [
          { text: 'Agent、创意写作与角色扮演', link: '/blog-agent-rp-harness' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/notnotype/neuro-book' }
    ]
  }
})

import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 按需引入，控制体积
echarts.use([PieChart, BarChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

export default echarts;

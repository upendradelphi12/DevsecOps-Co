using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DevOpsAIMonitor.Api.Controllers.Monitoring
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class StatusController : ControllerBase
    {
        [HttpGet("dashboard")]
        public IActionResult GetDashboardStatus()
        {
            return Ok(new
            {
                totalProjects = 14,
                runningPipelines = 27,
                failedPipelines = 4,
                runningPods = 21,
                failedPods = 2,
                aksClusters = 3,
                containerApps = 9,
                codeCoverage = 88,
                securityScore = 91,
            });
        }
    }
}

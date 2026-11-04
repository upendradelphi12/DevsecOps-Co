FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["DevOpsAIMonitor.Api/DevOpsAIMonitor.Api.csproj", "DevOpsAIMonitor.Api/"]
RUN dotnet restore "DevOpsAIMonitor.Api/DevOpsAIMonitor.Api.csproj"
COPY . .
WORKDIR "/src/DevOpsAIMonitor.Api"
RUN dotnet publish "DevOpsAIMonitor.Api.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "DevOpsAIMonitor.Api.dll"]
